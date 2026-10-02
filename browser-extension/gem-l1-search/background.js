// Minimal MV3 service worker. This extension does everything on-page
// (content.js) plus in the popup - background.js only exists so the
// manifest has somewhere valid to point "background.service_worker" at,
// the same reason the other single-site extensions in this repo
// (gem-orders-sync, gem-catalogue-sync) keep a near-empty background.js.
// No cross-origin calls are made here (no OMS sync for this tool), so
// there is nothing else for it to do.

chrome.runtime.onInstalled.addListener(() => {
  // no-op
});
