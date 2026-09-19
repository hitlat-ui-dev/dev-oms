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
});
