// ===== GeM Bid Sync -> Dev OMS bridge =====
// Runs as an MV3 service worker so the automated sync driver in content.js
// (which runs on bidplus.gem.gov.in) can reach the OMS API without hitting
// CORS - host_permissions in manifest.json grants this worker (and, since
// they're static rather than optional_host_permissions, content.js's own
// fetches too) cross-origin access with no runtime permission prompt needed,
// unlike the popup's chrome.permissions.request() flow which requires a
// live user gesture and can't fire from an unattended background run.

const OMS_URL_KEY = "gemOmsUrl";
// Was "http://localhost:3000" - that silently broke every Start-Sync run
// against the deployed OMS: the popup's OMS URL field defaults to whatever
// this constant is, and if nobody ever opens the popup to change it, this
// worker polls/posts to localhost forever while the real run sits in the
// deployed OMS's database, never picked up. Defaulting to the actual
// deployed OMS (also a static host_permission in manifest.json, so no
// runtime permission prompt) means Start Sync works out of the box; a
// local-dev OMS still works by typing http://localhost:3000 into the
// popup's OMS Server URL field, which is stored and always takes priority.
const DEFAULT_API_BASE = "https://dev-oms-blush.vercel.app";

async function getApiBase() {
  const data = await chrome.storage.local.get(OMS_URL_KEY);
  const stored = (data[OMS_URL_KEY] || "").trim().replace(/\/+$/, "");
  return stored || DEFAULT_API_BASE;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;

  if (message.type === "GEM_BID_SYNC_STATUS") {
    (async () => {
      try {
        const apiBase = await getApiBase();
        const qs = message.runId ? `?runId=${encodeURIComponent(message.runId)}` : "";
        const res = await fetch(`${apiBase}/api/gem-bids/sync/status${qs}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        sendResponse({ ok: true, run: data.run || null });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === "GEM_BID_SYNC_PROGRESS") {
    (async () => {
      try {
        const apiBase = await getApiBase();
        const res = await fetch(`${apiBase}/api/gem-bids/sync/progress`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: message.runId, percent: message.percent, phase: message.phase }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === "GEM_BID_SYNC_APPLY") {
    (async () => {
      try {
        const apiBase = await getApiBase();
        const res = await fetch(`${apiBase}/api/gem-bids/sync/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId: message.runId,
            rows: message.rows,
            userName: message.userName,
            submittedStatusUpdates: [],
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          sendResponse({ ok: false, error: data.error || `HTTP ${res.status}` });
          return;
        }
        sendResponse({ ok: true, result: data });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  // content.js can't call chrome.notifications directly (that API isn't
  // available to content scripts), so it asks this worker to show one -
  // used for "your Start-Sync run finished/failed" so it's visible even if
  // the GeM tab/window is minimized or you're working in a different one.
  if (message.type === "GEM_BID_SYNC_NOTIFY") {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: message.title || "GeM Bid Exporter",
      message: message.body || "",
      priority: 2,
    });
    sendResponse({ ok: true });
    return true;
  }

  // Drops the given cities from this state's cached city list (see
  // getCachedCities below) after an OMS-triggered "All Cities" batch finds
  // them genuinely empty ("No Data Found" on GeM) - content.js can't reach
  // the OMS API directly, same reason every other GEM_BID_SYNC_* message
  // exists here instead.
  if (message.type === "GEM_BID_CITIES_PRUNE") {
    (async () => {
      try {
        const apiBase = await getApiBase();
        const getRes = await fetch(`${apiBase}/api/gem-bids/cities?state=${encodeURIComponent(message.state)}`);
        const getData = getRes.ok ? await getRes.json() : { cities: [] };
        const remove = new Set((message.removeCities || []).map((c) => String(c).trim().toLowerCase()));
        const existing = Array.isArray(getData.cities) ? getData.cities : [];
        const kept = existing.filter((c) => !remove.has(String(c).trim().toLowerCase()));
        if (kept.length !== existing.length) {
          await fetch(`${apiBase}/api/gem-bids/cities`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: message.state, cities: kept }),
          });
        }
        sendResponse({ ok: true, pruned: existing.length - kept.length });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }
});

// The OMS's cache of GeM's own Consignee City dropdown for a state (see
// app/api/gem-bids/cities/route.ts), populated by the popup's "Load All
// Cities From GeM" button. Used below so an OMS-triggered "All Cities" run
// can expand to the real per-city list instead of one combined search with
// no city filter at all.
async function getCachedCities(state) {
  try {
    const apiBase = await getApiBase();
    const res = await fetch(`${apiBase}/api/gem-bids/cities?state=${encodeURIComponent(state)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.cities) ? data.cities : [];
  } catch (e) {
    return [];
  }
}

// ===== Auto-open the GeM tab for an OMS-triggered Start Sync run =====
//
// Clicking "Start Sync" on the OMS page creates a run with status:"scraping",
// phase:"starting" and (since the OMS page now collects them) filterState/
// filterCities/dateFrom/dateTo. Previously nothing acted on that run unless
// a bidplus.gem.gov.in tab already happened to be open (content.js's own
// poll only runs *inside* such a tab) - the user had to manually navigate to
// Advance Search and filter it by hand first. This worker now notices a
// fresh run on its own and opens/navigates a GeM tab to Advance Search
// itself, handing off the run's filters to content.js (which auto-injects
// on that navigation, per manifest.json's content_scripts match) via the
// same gemCityBatch storage key the popup's manual "Search + Scan These
// Cities" button already uses - so from content.js's side, an OMS-triggered
// run and a manual city batch are the exact same code path (see
// runBatchStepIfActive in content.js).
//
// MV3 service workers are killed when idle, so a plain setInterval here
// would stop firing - chrome.alarms is what actually wakes this worker back
// up. Chrome enforces a 1-minute floor on periodInMinutes, so there's up to
// ~1 minute of latency between clicking Start Sync and this noticing;
// acceptable given the scrape itself runs for minutes. An immediate check on
// install/startup/script-load avoids waiting for the first tick.
const POLL_ALARM_NAME = "gemBidSyncPoll";
const CLAIMED_RUN_KEY = "gemBgClaimedRunId";
const CITY_BATCH_KEY = "gemCityBatch";
const BID_START_DATE_FROM_KEY = "gemBidStartDateFrom";
const BID_START_DATE_TO_KEY = "gemBidStartDateTo";
// Same key content.js's filterRowsByItemKeywords() already reads for a
// manual scan's exclude-keyword box - reusing it means an OMS-triggered run
// applies the OMS's persisted exclude-keyword list (managed in the Start
// Sync modal, GET/POST /api/gem-bids/exclude-keywords) with no extra
// filtering logic needed in content.js.
const EXCLUDE_KEYWORDS_KEY = "gemItemExcludeKeywords";
const GEM_URL = "https://bidplus.gem.gov.in/advance-search#tab2";

function ensurePollAlarm() {
  chrome.alarms.get(POLL_ALARM_NAME, (existing) => {
    if (!existing) chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: 1 });
  });
}
chrome.runtime.onInstalled.addListener(ensurePollAlarm);
chrome.runtime.onStartup.addListener(ensurePollAlarm);
ensurePollAlarm();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM_NAME) {
    pollAndMaybeStartAutoSync();
    pollAndMaybeFetchBidDocuments();
  }
});
pollAndMaybeStartAutoSync();
pollAndMaybeFetchBidDocuments();

// Clearing the claim is content.js's job (finishOmsBatch, or the error/
// cancel paths in runBatchStepIfActive) - all of which run *inside* the GeM
// tab. If that tab gets closed outright (not just navigated) while a batch
// is mid-flight, its whole execution context dies with it and nothing ever
// gets a chance to clear the claim - this worker would otherwise sit
// convinced "a batch is already running" forever, silently refusing every
// future Start Sync. Since content.js can only ever run inside such a tab,
// "no bidplus.gem.gov.in tab exists at all" is an unambiguous signal that
// whatever claimed this is truly gone, not just slow - so that's checked
// first. A tab existing but the claim being implausibly old (hours) is a
// second, cheaper safety net for any other way this could get stuck.
const CLAIM_STALE_MS = 60 * 60 * 1000; // 1 hour

async function clearOrphanedClaimIfAny() {
  const claimData = await chrome.storage.local.get(CLAIMED_RUN_KEY);
  const claim = claimData[CLAIMED_RUN_KEY];
  if (!claim) return;

  const claimedAt = typeof claim === "object" && claim ? claim.claimedAt : 0;
  const tooOld = !claimedAt || Date.now() - claimedAt > CLAIM_STALE_MS;
  const tabs = await chrome.tabs.query({ url: "https://bidplus.gem.gov.in/*" });

  if (tabs.length > 0 && !tooOld) return; // plausibly still being driven - leave it alone

  console.warn("[GeM Bid Exporter] clearing an orphaned sync claim (no GeM tab left to drive it, or claim too old):", claim);
  await chrome.storage.local.remove(CLAIMED_RUN_KEY);
  const cbData = await chrome.storage.local.get(CITY_BATCH_KEY);
  const batch = cbData[CITY_BATCH_KEY];
  if (batch && batch.running) {
    batch.running = false;
    await chrome.storage.local.set({ [CITY_BATCH_KEY]: batch });
  }
}

// Retries a chrome.tabs.sendMessage a few times (content.js may not have
// injected/finished its own setup yet right after the tab was just created
// or navigated) - shared by the city-list fetch and the batch-kick below so
// neither has to hand-roll the same retry loop.
async function sendTabMessageWithRetry(tabId, message, attempts = 12, delayMs = 1000) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (e) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return null;
}

async function pollAndMaybeStartAutoSync() {
  try {
    await clearOrphanedClaimIfAny();

    // Already driving a batch (OMS-triggered or, via the shared running
    // flag check below, even a manual one) - don't stomp on it by
    // navigating the tab away or overwriting its job mid-scan. It'll be
    // re-checked on the next alarm tick once that batch clears the claim.
    const claimData = await chrome.storage.local.get(CLAIMED_RUN_KEY);
    if (claimData[CLAIMED_RUN_KEY]) return;

    const cbData = await chrome.storage.local.get(CITY_BATCH_KEY);
    if (cbData[CITY_BATCH_KEY] && cbData[CITY_BATCH_KEY].running) return;

    const apiBase = await getApiBase();
    const res = await fetch(`${apiBase}/api/gem-bids/sync/status`);
    if (!res.ok) return;
    const data = await res.json();
    const run = data.run;
    // Only claim a brand-new, not-yet-picked-up run - one still on its
    // initial "starting" phase. Anything further along is either already
    // being driven (by this worker, moments ago) or is a stale/finished run
    // that happens to be the most recent one in the collection.
    if (!run || run.status !== "scraping" || run.phase !== "starting") return;

    // Claimed immediately, before the (possibly slow - see below) city-list
    // resolution, so a second alarm tick a minute from now can't pick the
    // same run up again and open a second tab/batch for it.
    await chrome.storage.local.set({ [CLAIMED_RUN_KEY]: { runId: run._id, claimedAt: Date.now() } });

    const existingTabs = await chrome.tabs.query({ url: "https://bidplus.gem.gov.in/*" });
    const existingTab = existingTabs.find((t) => t.active) || existingTabs[0];
    let tabId;
    if (existingTab) {
      await chrome.tabs.update(existingTab.id, { url: GEM_URL, active: true });
      tabId = existingTab.id;
    } else {
      const created = await chrome.tabs.create({ url: GEM_URL, active: true });
      tabId = created.id;
    }

    const state = run.filterState || "Gujarat";
    let cities = Array.isArray(run.filterCities) && run.filterCities.length ? run.filterCities : null;

    if (!cities) {
      // "All Cities" in the Start Sync modal sends filterCities as [] - try
      // the cache first (fast, no tab round trip).
      const cached = await getCachedCities(state);
      if (cached.length) {
        cities = cached;
      } else {
        // Cache empty (nobody's ever clicked "Load All Cities From GeM" in
        // the popup for this state) - fetch the real list straight from the
        // tab just opened/navigated above, via the same GET_CITY_LIST path
        // the popup's own button uses. This used to fall back to [""] here
        // instead - one combined search with no city filter at all, which
        // for "All Cities" in Gujarat meant a single continuous 300+ page
        // scan. That path has now died mid-scan on its own twice (not a
        // one-off) - removed entirely rather than kept as a "safety net"
        // that was actually the least reliable option available.
        const cityResult = await sendTabMessageWithRetry(tabId, { action: "GET_CITY_LIST", state });
        if (cityResult && cityResult.ok && Array.isArray(cityResult.cities) && cityResult.cities.length) {
          cities = cityResult.cities;
          // Cache it so the next "All Cities" run for this state skips this
          // wait entirely - best-effort, a failed cache write here doesn't
          // block this run from using the list it already has.
          fetch(`${apiBase}/api/gem-bids/cities`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state, cities }),
          }).catch(() => {});
        }
      }
    }

    if (!cities || !cities.length) {
      console.error(
        "[GeM Bid Exporter] couldn't resolve a city list for",
        state,
        "- stopping this run rather than falling back to the unreliable combined search"
      );
      await chrome.storage.local.remove(CLAIMED_RUN_KEY);
      await fetch(`${apiBase}/api/gem-bids/sync/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: run._id }),
      }).catch(() => {});
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "GeM Bid Sync couldn't start",
        message: `Couldn't load the city list for ${state}. Open the extension popup, click "Load All Cities From GeM" once, then try Start Sync again.`,
        priority: 2,
      });
      return;
    }

    await chrome.storage.local.set({
      [BID_START_DATE_FROM_KEY]: run.dateFrom || "",
      [BID_START_DATE_TO_KEY]: run.dateTo || "",
      [EXCLUDE_KEYWORDS_KEY]: Array.isArray(run.excludeKeywords) ? run.excludeKeywords.join(", ") : "",
      [CITY_BATCH_KEY]: {
        state,
        cities,
        index: 0,
        phase: "search",
        running: true,
        omsRunId: run._id,
      },
    });

    // content.js's own unconditional runBatchStepIfActive() call at the
    // bottom of its file may already have run (and found nothing) before
    // CITY_BATCH_KEY was set just now, especially on the "All Cities, empty
    // cache" path above which can take a few seconds - nudge it explicitly
    // rather than relying on that one-shot call alone having won the race.
    sendTabMessageWithRetry(tabId, { action: "KICK_BATCH" }, 6, 500);
  } catch (e) {
    console.error("[GeM Bid Exporter] background sync poll failed:", e);
  }
}

// ===== Image-based ATC: fetch a bid's real documents into R2 =====
//
// Document Maker's "Fetch bid documents" button (see app/dashboard/gem-bids/
// document-maker/page.tsx) queues a bid by POSTing /api/gem-bids/fetch-
// documents, which just sets docFetch.status = "pending" on that bid - this
// worker's existing 1/min alarm is what actually does the fetching, same
// division of labor as Start Sync. No GeM tab is needed for this one: unlike
// content.js's page-context fetches, this runs the fetch directly from the
// service worker, relying on the same host_permissions-granted cross-origin
// + cookie access this file's very first comment already documents for the
// OMS API calls above - bidplus.gem.gov.in is in that same host_permissions
// list, so as long as the user is logged into GeM in this browser profile,
// these requests carry that session the same way a content-script fetch
// would. If the resolved response isn't actually a PDF (session invalid, or
// the link embedded in the bid at scrape time has since expired), isLikelyPdf
// catches that instead of silently uploading a login/error page as if it
// were the real document.
async function isLikelyPdf(resp) {
  const ct = (resp.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("pdf")) return true;
  // Content-Type can be missing/generic on some GeM responses - fall back to
  // sniffing the actual bytes for the "%PDF-" magic header.
  const buf = await resp.clone().arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 5));
  return String.fromCharCode(...head) === "%PDF-";
}

// Mirrors content.js's fetchAndParsePdf() two-step resolution (direct PDF,
// or an interim HTML page with a real PDF link inside it) - duplicated
// rather than shared, since content.js only runs inside a GeM tab and this
// needs to work from the service worker with no tab at all.
async function fetchGemPdfBytes(url) {
  const resp = await fetch(url, { credentials: "include" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  if (await isLikelyPdf(resp)) return resp.arrayBuffer();

  const html = await resp.text();
  if (/captcha/i.test(html)) throw new Error("GeM showed a captcha page instead of the document");
  const m =
    html.match(/href=["']([^"']+\.pdf[^"']*)["']/i) ||
    html.match(/href=["']([^"']*(?:showbiddocument|ShowBidDocument|showBidDocument)[^"']*)["']/i);
  if (!m) throw new Error("Response wasn't a PDF and no PDF link was found in it (session may have expired)");

  const pdfUrl = new URL(m[1], url).href;
  const resp2 = await fetch(pdfUrl, { credentials: "include" });
  if (!resp2.ok || !(await isLikelyPdf(resp2))) {
    throw new Error("Couldn't resolve a real PDF from this link");
  }
  return resp2.arrayBuffer();
}

async function uploadFetchedBidDoc(apiBase, bidId, kind, arrayBuffer) {
  const fd = new FormData();
  fd.append("bidId", bidId);
  fd.append("kind", kind);
  fd.append("file", new Blob([arrayBuffer], { type: "application/pdf" }), `${kind}.pdf`);
  const res = await fetch(`${apiBase}/api/gem-bids/fetch-documents/upload`, { method: "POST", body: fd });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
}

let docFetchInFlight = false;

async function pollAndMaybeFetchBidDocuments() {
  if (docFetchInFlight) return; // one job at a time, same as the city batch's own guard
  docFetchInFlight = true;
  try {
    const apiBase = await getApiBase();
    const res = await fetch(`${apiBase}/api/gem-bids/fetch-documents`);
    if (!res.ok) return;
    const data = await res.json();
    const bid = data.bid;
    if (!bid) return;

    const errors = {};

    if (bid.bidLink) {
      try {
        const bytes = await fetchGemPdfBytes(bid.bidLink);
        await uploadFetchedBidDoc(apiBase, bid._id, "bidLink", bytes);
      } catch (e) {
        errors.bidLink = String((e && e.message) || e);
      }
    } else {
      errors.bidLink = "This bid has no Bid Link";
    }

    // Blank on many bids - GeM's ATC download is often a JS action rather
    // than a real link embedded in the PDF (see content.js's ATC_LABEL
    // comment), not a sign anything is broken.
    if (bid.buyerAddedBidSpecificAtcUrl) {
      try {
        const bytes = await fetchGemPdfBytes(bid.buyerAddedBidSpecificAtcUrl);
        await uploadFetchedBidDoc(apiBase, bid._id, "atc", bytes);
      } catch (e) {
        errors.atc = String((e && e.message) || e);
      }
    } else {
      errors.atc = "No buyer-added ATC link on this bid";
    }

    await fetch(`${apiBase}/api/gem-bids/fetch-documents/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bidId: bid._id, errors }),
    });
  } catch (e) {
    console.error("[GeM Bid Exporter] bid-document fetch poll failed:", e);
  } finally {
    docFetchInFlight = false;
  }
}
