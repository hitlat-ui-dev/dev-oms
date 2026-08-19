// ===== Sends scraped GeM orders to the Dev OMS staging endpoint =====
// Runs in the background service worker so requests aren't blocked by the
// GeM page's CORS policy (extensions bypass CORS for hosts listed in
// "host_permissions" in manifest.json).
//
// Points at the deployed OMS since that's what's used when testing the
// extension on the live GeM site. Switch back to "http://localhost:3000"
// only when running the OMS dev server locally
// (localhost:3000/dashboard/orders/fetch-gem-orders):
const API_BASE = "https://dev-oms-blush.vercel.app";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;

  if (message.type === "GEM_ORDERS_DEBUG_LOG") {
    console.log("[GeM Orders Debug] parsed item name:", message.parsedItemName);
    console.log("[GeM Orders Debug] parsed unit price:", message.parsedUnitPrice);
    console.log("[GeM Orders Debug] card innerText:");
    console.log(message.text);
    console.log("[GeM Orders Debug] card outerHTML:");
    console.log(message.html);
    return false;
  }

  // Fetches the firm list for the "select your firm" dropdown shown before scanning.
  if (message.type === "GEM_GET_FIRMS") {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/companies`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const companies = await res.json();
        const firms = (Array.isArray(companies) ? companies : [])
          .map((c) => ({ firmCode: (c.firmCode || "").trim().toUpperCase(), firmName: c.firmName || "" }))
          .filter((f) => f.firmCode)
          .sort((a, b) => a.firmCode.localeCompare(b.firmCode));
        sendResponse({ ok: true, firms });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  // Sends a single scraped order to the staging endpoint. Orders are sent one
  // at a time (content.js loops and awaits each call) instead of one giant
  // batch loop in here - MV3 service workers can get killed by Chrome after
  // ~30s of no extension-API activity, which was silently swallowing the
  // "done" response (and the final saved/duplicate summary) on bigger scans.
  if (message.type === "GEM_SEND_ONE_ORDER") {
    (async () => {
      const order = message.order;
      try {
        const res = await fetch(`${API_BASE}/api/gem-orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contractNo: order.contractNo,
            contractDate: order.contractDate,
            contractUrl: order.contractUrl,
            buyerDesignation: order.buyerDesignation,
            department: order.department,
            location: order.location,
            instituteName: order.instituteName,
            itemName: order.itemName || order.itemNameRaw || "GeM Order Item",
            qty: order.qty,
            rate: order.rate,
            total: order.total,
            firmCode: message.firmCode,
            gemStatus: order.gemStatus
          })
        });

        if (res.status === 409) sendResponse({ status: "duplicate" });
        else if (res.ok) sendResponse({ status: "saved" });
        else sendResponse({ status: "error", error: `HTTP ${res.status}` });
      } catch (err) {
        sendResponse({ status: "error", error: err.message });
      }
    })();
    return true;
  }
});
