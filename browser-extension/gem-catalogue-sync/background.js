// ===== Sends scraped GeM catalogue rows to the Dev OMS GeM Sync Console =====
// Runs in the background service worker so the request isn't blocked by the
// GeM page's CORS policy (extensions bypass CORS for hosts listed in
// "host_permissions" in manifest.json).
//
// Change this if Dev OMS is deployed somewhere other than here (and add the
// new URL to host_permissions in manifest.json too):
const API_BASE = "https://dev-oms-blush.vercel.app";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;

  if (message.type === "GEM_SEND_CATALOGUE") {
    fetch(`${API_BASE}/api/gem-sync?action=save_catalogue_links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firmCode: message.firmCode, rows: message.rows })
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        sendResponse({ success: true, count: data.count ?? message.rows.length });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message || "Network error" });
      });
    return true; // keep the message channel open for the async sendResponse above
  }

  if (message.type === "GEM_SEND_STOCK") {
    fetch(`${API_BASE}/api/gem-sync?action=save_stock_fields`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firmCode: message.firmCode,
        productId: message.productId,
        catalogueId: message.catalogueId,
        currentStock: message.currentStock,
        minQtyPerConsignee: message.minQtyPerConsignee
      })
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        sendResponse({ success: true, matched: data.matched });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message || "Network error" });
      });
    return true;
  }

  if (message.type === "GEM_DEBUG_LOG") {
    console.log("[GeM Debug] Action column HTML dump (first 3 rows):");
    (message.dump || []).forEach((r, i) => {
      console.log(`--- Row ${i + 1}: "${r.row}" (${r.totalColumns} columns) ---`);
      console.log(r.actionCellHTML);
    });
    return false;
  }

  if (message.type === "GEM_FETCH_ALL_STOCK") {
    const sourceTabId = sender.tab && sender.tab.id;
    if (!sourceTabId) {
      sendResponse({ started: false, error: "Source tab not found" });
      return false;
    }
    // Fire and forget: progress/completion are reported back via
    // GEM_STOCK_PROGRESS / GEM_STOCK_DONE messages sent to sourceTabId,
    // since this loop can run for several minutes across many products.
    fetchAllStock(message.firmCode, message.rows, sourceTabId);
    sendResponse({ started: true });
    return false;
  }
});

// ===== Bulk stock fetch: open each product's page in a hidden tab, scrape =====
// its Current Stock / Min Qty Per Consignee fields, save to Dev OMS, close it,
// move to the next product. Sequential (not parallel) and throttled so it
// behaves like a patient human clicking through pages, not a burst of traffic.

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const start = Date.now();
    function check() {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) return resolve(false);
        if (tab.status === "complete") return resolve(true);
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(check, 300);
      });
    }
    check();
  });
}

// Injected into the product tab. Must be fully self-contained (no closures
// over outer scope) since chrome.scripting.executeScript serializes it.
function scrapeStockFieldsInPage() {
  function findLabeledInputValue(labelRegex) {
    const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
    for (const input of inputs) {
      let el = input.closest("tr") || input.parentElement;
      let hops = 0;
      while (el && hops < 4) {
        const text = el.textContent.trim();
        if (text.length < 200 && labelRegex.test(text)) return input.value.trim();
        el = el.parentElement;
        hops++;
      }
    }
    return null;
  }
  const bodyText = document.body.textContent;
  const isReady = /minimum quantity per consignee/i.test(bodyText) && /current stock/i.test(bodyText);
  if (!isReady) {
    // Diagnostics: tells us whether the page is just slow to render (short
    // bodyText, mostly whitespace) or whether it fully rendered but is simply
    // the wrong page (has real content, but never the stock labels we expect).
    return {
      ready: false,
      url: window.location.href,
      title: document.title,
      bodyTextLength: bodyText.trim().length,
      bodySample: bodyText.trim().replace(/\s+/g, " ").slice(0, 400)
    };
  }

  // GeM shows this note when the seller's stock entry has been marked invalid -
  // such products must never be synced to OMS, so flag it and stop right here.
  if (/stock\s*has\s*been\s*marked\s*invalid/i.test(bodyText)) {
    return { ready: true, invalid: true };
  }

  const haystack = window.location.href + " " + bodyText;
  const catalogueIdMatch = haystack.match(/\d{5,}-\d{6,}-cat\b/);
  const productIdMatch = haystack.match(/\b\d{6,}-\d{8,}\b(?!-cat)/);

  return {
    ready: true,
    invalid: false,
    catalogueId: catalogueIdMatch ? catalogueIdMatch[0] : null,
    productId: productIdMatch ? productIdMatch[0] : null,
    currentStock: findLabeledInputValue(/current\s*stock.*maximum\s*quantity/i),
    minQtyPerConsignee: findLabeledInputValue(/minimum\s*quantity\s*per\s*consignee/i)
  };
}

async function scrapeStockFromTab(tabId) {
  const injections = await chrome.scripting.executeScript({
    target: { tabId },
    func: scrapeStockFieldsInPage
  });
  return injections && injections[0] ? injections[0].result : null;
}

async function fetchAllStock(firmCode, rows, sourceTabId) {
  let successCount = 0;
  let failedCount = 0;
  let invalidCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // Only the Action column's link goes to THIS seller's own offering page.
    // Name / Gem Catalogue Id open a shared multi-seller page - never use those
    // here, since scraping stock/min-qty off it could grab another seller's numbers.
    const href = row["Action"] && row["Action"].href;
    const name = (row["Name"] && row["Name"].text) || (row["ProductID"] && row["ProductID"].text) || `#${i + 1}`;

    chrome.tabs.sendMessage(sourceTabId, { type: "GEM_STOCK_PROGRESS", index: i + 1, total: rows.length, name }).catch(() => {});

    if (!href) {
      console.warn(`[GeM Stock ${i + 1}/${rows.length}] SKIPPED "${name}" - no Action link found in this row.`, row["Action"]);
      failedCount++;
      continue;
    }

    console.log(`[GeM Stock ${i + 1}/${rows.length}] "${name}" -> opening`, href);

    let tab = null;
    try {
      tab = await chrome.tabs.create({ url: href, active: false });
      const loaded = await waitForTabComplete(tab.id);

      let data = null;
      if (loaded) {
        // The product page is an Angular SPA - "complete" only means the initial
        // HTML/JS loaded, not that the form has rendered yet. Poll a bit.
        // Background (inactive) tabs can render noticeably slower under Chrome's
        // throttling, so give this more headroom than a foreground page would need.
        for (let attempt = 0; attempt < 20; attempt++) {
          await sleep(1500);
          data = await scrapeStockFromTab(tab.id).catch(() => null);
          if (data && data.ready) break;
        }
      }

      console.log(`[GeM Stock ${i + 1}/${rows.length}] "${name}" scraped:`, data);

      if (data && data.ready && data.invalid) {
        // Stock marked invalid on GeM - deliberately not saved to OMS.
        invalidCount++;
      } else if (data && data.ready && (data.currentStock || data.minQtyPerConsignee)) {
        const res = await fetch(`${API_BASE}/api/gem-sync?action=save_stock_fields`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            firmCode,
            productId: data.productId,
            catalogueId: data.catalogueId,
            currentStock: data.currentStock,
            minQtyPerConsignee: data.minQtyPerConsignee
          })
        });
        const resBody = await res.json().catch(() => null);
        console.log(`[GeM Stock ${i + 1}/${rows.length}] "${name}" save result:`, res.status, resBody);
        if (res.ok) successCount++;
        else failedCount++;
      } else {
        console.warn(`[GeM Stock ${i + 1}/${rows.length}] "${name}" FAILED - page never became ready or no fields found (loaded=${loaded}).`);
        failedCount++;
      }
    } catch (err) {
      console.error(`[GeM Stock ${i + 1}/${rows.length}] "${name}" threw:`, err);
      failedCount++;
    } finally {
      if (tab) await chrome.tabs.remove(tab.id).catch(() => {});
    }

    await sleep(700); // gentle gap between products
  }

  chrome.tabs.sendMessage(sourceTabId, {
    type: "GEM_STOCK_DONE",
    successCount,
    failedCount,
    invalidCount,
    total: rows.length
  }).catch(() => {});
}
