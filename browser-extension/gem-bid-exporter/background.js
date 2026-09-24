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
});

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
  if (alarm.name === POLL_ALARM_NAME) pollAndMaybeStartAutoSync();
});
pollAndMaybeStartAutoSync();

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

    await chrome.storage.local.set({ [CLAIMED_RUN_KEY]: { runId: run._id, claimedAt: Date.now() } });
    await chrome.storage.local.set({
      [BID_START_DATE_FROM_KEY]: run.dateFrom || "",
      [BID_START_DATE_TO_KEY]: run.dateTo || "",
      [EXCLUDE_KEYWORDS_KEY]: Array.isArray(run.excludeKeywords) ? run.excludeKeywords.join(", ") : "",
      [CITY_BATCH_KEY]: {
        state: run.filterState || "Gujarat",
        cities: Array.isArray(run.filterCities) && run.filterCities.length ? run.filterCities : [""],
        index: 0,
        phase: "search",
        running: true,
        omsRunId: run._id,
      },
    });

    const existing = await chrome.tabs.query({ url: "https://bidplus.gem.gov.in/*" });
    if (existing.length) {
      const tab = existing.find((t) => t.active) || existing[0];
      await chrome.tabs.update(tab.id, { url: GEM_URL, active: true });
    } else {
      await chrome.tabs.create({ url: GEM_URL, active: true });
    }
  } catch (e) {
    console.error("[GeM Bid Exporter] background sync poll failed:", e);
  }
}
