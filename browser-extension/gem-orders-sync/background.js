// ===== Sends scraped GeM orders to the Dev OMS staging endpoint =====
// Runs in the background service worker so requests aren't blocked by the
// GeM page's CORS policy (extensions bypass CORS for hosts listed in
// "host_permissions" in manifest.json).
//
// Pointed at local dev server for now, since that's where you're testing
// (localhost:3000/dashboard/orders/fetch-gem-orders). Switch this to
// "https://dev-oms-blush.vercel.app" once the latest code is deployed there
// (and you're reviewing orders on the live site instead of localhost):
const API_BASE = "http://localhost:3000";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  if (message.type !== "GEM_SEND_ORDERS") return;

  (async () => {
    let saved = 0;
    let duplicate = 0;
    let error = 0;

    for (const order of message.orders) {
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

        if (res.status === 409) duplicate++;
        else if (res.ok) saved++;
        else error++;
      } catch (err) {
        error++;
      }

      await sleep(250); // gentle gap between requests
    }

    sendResponse({ done: true, saved, duplicate, error, total: message.orders.length });
  })();

  return true; // keep the message channel open for the async sendResponse above
});
