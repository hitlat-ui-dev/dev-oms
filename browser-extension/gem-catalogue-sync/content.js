// ===== GeM Bill Auto Fill =====
// Ye extension GeM ke "Invoice Details" form (Order Summary -> Invoice Details)
// ke fixed fields ko ek button click se fill karta hai.
//
// FIXED VALUES (apni firm ke hisaab se yahan edit kar sakte ho):
const CONFIG = {
  DISPATCH_MODE: "Manual",           // Mode of dispatch: Transport / Online / Manual / Courier
  PLACE_OF_SUPPLY: "Buyer Location", // Place of Supply: Buyer Location / Consignee Location
  PLACE_OF_SUPPLY_STATE_UT: "Gujarat / 24", // Always this state, regardless of buyer
  SVC_APPLICABLE: "No",  // Statutory Variation Clause - always No
  GST_UQ_NAME: "NOS"     // GST Unit Quantity name - always NOS (Numbers)
};

let btnInjected = false;
let isScanning = false;
let contextInvalidWarned = false;

function log(msg) {
  console.log("[GeM AutoFill]", msg);
}

// True once the extension is reloaded/updated while this content script is
// still running in an already-open tab - all chrome.* calls throw after that.
// Only a page refresh (fresh script injection) fixes it.
function isExtensionContextValid() {
  try {
    return !!(chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

function warnContextInvalidated() {
  if (contextInvalidWarned) return;
  contextInvalidWarned = true;
  showToast("Extension reload hui hai - is GeM tab ko refresh (F5) karo, phir button dikhega.", true);
}

function showToast(message, isError) {
  let toast = document.getElementById("gem-autofill-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "gem-autofill-toast";
    document.body.appendChild(toast);
  }
  toast.style.background = isError ? "#b3261e" : "#202124";
  toast.textContent = message;
  toast.style.display = "block";
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => {
    toast.style.display = "none";
  }, 4000);
}

// Dispatch the events that Angular/jQuery based GeM form listens to
function fireEvents(el) {
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur", { bubbles: true }));
}

function setTextValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return false;
  el.value = value;
  fireEvents(el);
  return true;
}

function setSelectValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return false;

  const wasDisabled = el.disabled;
  if (wasDisabled) el.removeAttribute("disabled");

  let matched = false;
  for (const opt of el.options) {
    if (opt.value === value) {
      el.value = value;
      matched = true;
      break;
    }
  }
  // fallback: match by visible text if exact value not found
  if (!matched) {
    for (const opt of el.options) {
      if (opt.textContent.trim() === value) {
        el.value = opt.value;
        matched = true;
        break;
      }
    }
  }

  fireEvents(el);
  if (wasDisabled) el.setAttribute("disabled", "disabled");
  return matched;
}

// Find "Contract Date: DD/MM/YYYY" text shown at the top of Order Details panel
function getContractDate() {
  const headings = document.querySelectorAll(".hea-title h3");
  for (const h of headings) {
    if (h.textContent.includes("Contract Date")) {
      const match = h.textContent.match(/(\d{2}\/\d{2}\/\d{4})/);
      if (match) return match[1];
    }
  }
  return null;
}

// Find "Pending items to ship : N" text shown on the Product Details page
function getPendingQty() {
  const match = document.body.textContent.match(/Pending items to ship\s*:\s*(\d+)/i);
  return match ? match[1] : null;
}

function fillProductForm() {
  const results = [];

  const okSvc = setSelectValue("INVOICE_ITEMS_FORM-SVC_TOGGLE", CONFIG.SVC_APPLICABLE);
  results.push(okSvc ? `SVC Applicable: ${CONFIG.SVC_APPLICABLE}` : "SVC field not found");

  const pendingQty = getPendingQty();
  if (pendingQty) {
    const okQty = setTextValue("INVOICE_ITEMS_FORM-SuppliedQty", pendingQty);
    results.push(okQty ? `Supplied Qty: ${pendingQty}` : "Supplied Qty field not found");
  } else {
    results.push("Pending qty page par nahi mila - manually daal do");
  }

  const okUq = setSelectValue("INVOICE_ITEMS_FORM-GST_UQ_NAME", CONFIG.GST_UQ_NAME);
  results.push(okUq ? `GST UQ Name: ${CONFIG.GST_UQ_NAME}` : "GST UQ Name not found");

  log(results.join(" | "));
  showToast(results.join("\n"));
}

// ===== Catalogue Sync (admin-mkp.gem.gov.in -> Dev OMS GeM Sync Console) =====

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Find the products table by looking for its distinctive header text.
// Only checks the header row (not the whole table) to keep this cheap,
// since this runs frequently while the page is still rendering.
function findCatalogueTable() {
  const tables = document.querySelectorAll("table");
  for (const t of tables) {
    const headerRow = t.querySelector("thead") || t.rows[0];
    if (!headerRow) continue;
    const headerText = headerRow.textContent;
    if (headerText.includes("Gem Catalogue Id") && headerText.includes("ProductID")) {
      return t;
    }
  }
  return null;
}

function extractCatalogueRows(table) {
  const headers = [
    "Name", "Title on Market Place", "ProductID", "Gem Catalogue Id",
    "Category", "Brand", "Model", "MRP/NDP", "Offer Price",
    "Product Status", "Inventory Status"
  ];
  const rows = [];
  const trs = table.querySelectorAll("tbody tr");
  trs.forEach((tr) => {
    const tds = tr.querySelectorAll("td");
    if (tds.length >= 11) {
      const actionCell = tds[11];
      const actionText = actionCell ? actionCell.innerText.trim() : "";

      // GeM sometimes shows a note right in the Action column flagging the
      // product as OEM-unauthorized or its stock as invalid - such products
      // must never be synced to OMS, so skip the row entirely here.
      if (/marked\s*unauthorized/i.test(actionText) || /stock\s*has\s*been\s*marked\s*invalid/i.test(actionText)) {
        return;
      }

      const row = {};
      headers.forEach((h, i) => {
        const cell = tds[i];
        const link = cell.querySelector("a");
        row[h] = {
          text: cell.innerText.trim(),
          href: link ? link.href : null
        };
      });

      // 12th column ("Action(s)") holds THIS seller's own edit/offering link.
      // The "Name"/"Gem Catalogue Id" links above open the shared, multi-seller
      // listing page instead - scraping stock/min-qty from there can pick up a
      // different seller's numbers, so the Action link is the only safe one to use.
      if (actionCell) {
        const actionLink = actionCell.querySelector("a[href]");
        row["Action"] = {
          text: actionText,
          href: actionLink ? actionLink.href : null
        };
      }

      rows.push(row);
    }
  });
  return rows;
}

// Finds the pagination "next" arrow (›), returns null if not found or disabled
function findNextPageLink() {
  const links = Array.from(document.querySelectorAll(".pagination a, ul.pagination a"));
  for (const a of links) {
    const txt = a.textContent.trim();
    if (txt === "›" || txt.toLowerCase() === "next") {
      const li = a.closest("li");
      if (li && li.classList.contains("disabled")) return null;
      return a;
    }
  }
  return null;
}

function getFirstRowProductId(table) {
  const firstRow = table && table.querySelector("tbody tr");
  if (!firstRow) return null;
  const tds = firstRow.querySelectorAll("td");
  return tds.length >= 3 ? tds[2].innerText.trim() : null;
}

async function waitForPageChange(previousFirstId, maxWaitMs = 6000, intervalMs = 300) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await sleep(intervalMs);
    const table = findCatalogueTable();
    const currentFirstId = getFirstRowProductId(table);
    if (currentFirstId && currentFirstId !== previousFirstId) return true;
  }
  return false;
}

// Scrapes every page of the catalogue, then hands the rows off to the
// background service worker, which POSTs them to the Dev OMS GeM Sync
// Console (app/api/gem-sync?action=save_catalogue_links).
async function syncCatalogueToConsole() {
  // Ask which firm/seller account this catalogue belongs to, since one person
  // may run this across 10+ different GeM seller accounts. Pre-fills the last
  // value used so switching back to the same firm is a single click.
  const stored = await chrome.storage.local.get(["lastFirmCode"]);
  const firmCodeInput = prompt(
    "Ye catalogue kis Firm/Seller account ka hai? (Firm Code likho, jaise MK, VARSH, SS)",
    stored.lastFirmCode || ""
  );
  if (!firmCodeInput || !firmCodeInput.trim()) {
    showToast("Firm code diye bina sync cancel ho gaya.", true);
    return;
  }
  const firmCode = firmCodeInput.trim().toUpperCase();
  await chrome.storage.local.set({ lastFirmCode: firmCode });

  isScanning = true;
  const btn = document.getElementById("gem-autofill-btn");
  let allRows = [];
  let pageCount = 0;
  const maxPages = 100; // safety cap

  while (pageCount < maxPages) {
    const table = findCatalogueTable();
    if (!table) {
      showToast("Catalogue table nahi mila", true);
      isScanning = false;
      return;
    }
    if (btn) btn.textContent = `⏳ Page ${pageCount + 1} scan ho raha hai...`;

    const rows = extractCatalogueRows(table);
    allRows = allRows.concat(rows);
    pageCount++;

    const previousFirstId = getFirstRowProductId(table);
    const nextLink = findNextPageLink();
    if (!nextLink) break;

    nextLink.click();
    const changed = await waitForPageChange(previousFirstId);
    if (!changed) break; // couldn't confirm page changed, stop to avoid duplicate/incomplete data
  }

  if (!allRows.length) {
    showToast("Koi rows nahi mile - sync cancel", true);
    isScanning = false;
    if (btn) btn.textContent = buttonLabelFor("catalogue");
    return;
  }

  if (btn) btn.textContent = "📤 Sync Console ko bheja ja raha hai...";

  chrome.runtime.sendMessage(
    { type: "GEM_SEND_CATALOGUE", rows: allRows, firmCode },
    (response) => {
      isScanning = false;
      if (btn) btn.textContent = buttonLabelFor("catalogue");

      if (chrome.runtime.lastError) {
        showToast("Extension error: " + chrome.runtime.lastError.message, true);
        return;
      }
      if (response && response.success) {
        showToast(`✓ ${firmCode}: ${allRows.length} products Sync Console me bhej diye (${pageCount} pages)`);
      } else {
        showToast("Bhejne me fail: " + (response && response.error ? response.error : "unknown error"), true);
      }
    }
  );
}

function isCataloguePage() {
  return !!findCatalogueTable();
}

// Debug helper: since F12/right-click Inspect are blocked on this GeM page
// (managed browser policy), dump the first few rows' Action-column HTML to
// the extension's service worker console instead (opened via
// chrome://extensions -> this extension's "service worker" link), which is
// reachable even when DevTools is disabled for regular web pages.
function debugDumpActionCells() {
  const table = findCatalogueTable();
  if (!table) {
    showToast("Catalogue table nahi mila", true);
    return;
  }
  const trs = Array.from(table.querySelectorAll("tbody tr")).slice(0, 3);
  const dump = trs.map((tr, i) => {
    const tds = tr.querySelectorAll("td");
    const nameCell = tds[0] ? tds[0].innerText.trim() : `row ${i}`;
    const actionCell = tds[11];
    return {
      row: nameCell,
      actionCellHTML: actionCell ? actionCell.innerHTML.trim() : "(no 12th column found)",
      totalColumns: tds.length
    };
  });
  chrome.runtime.sendMessage({ type: "GEM_DEBUG_LOG", dump });
  showToast("Debug info service worker console me bhej diya - wahan check karo.");
}

let isFetchingStock = false;

// Scans every page of the catalogue (same pagination logic as syncCatalogueToConsole,
// without re-prompting for firm code), then hands the rows off to the background
// service worker, which opens each product's page in a hidden tab one at a time,
// scrapes its stock/min-qty fields, and saves them - no manual per-product click needed.
async function fetchAllStockToConsole() {
  if (isFetchingStock) return;
  if (!isExtensionContextValid()) {
    warnContextInvalidated();
    return;
  }

  try {
    await fetchAllStockToConsoleInner();
  } catch (err) {
    isFetchingStock = false;
    isScanning = false;
    const stockBtn = document.getElementById("gem-fetch-stock-btn");
    if (stockBtn) stockBtn.textContent = "📥 Fetch All Stock";
    if (!isExtensionContextValid()) warnContextInvalidated();
    else showToast("Fetch All Stock me error: " + (err && err.message ? err.message : err), true);
  }
}

async function fetchAllStockToConsoleInner() {
  const stored = await chrome.storage.local.get(["lastFirmCode"]);
  let firmCode = stored.lastFirmCode;
  if (!firmCode) {
    const firmCodeInput = prompt("Ye catalogue kis Firm/Seller account ka hai? (Firm Code likho, jaise MK, VARSH, SS)");
    if (!firmCodeInput || !firmCodeInput.trim()) {
      showToast("Firm code diye bina cancel ho gaya.", true);
      return;
    }
    firmCode = firmCodeInput.trim().toUpperCase();
    await chrome.storage.local.set({ lastFirmCode: firmCode });
  }

  const pageLimitInput = prompt(
    "Kitne catalogue pages process karne hain?\n\n" +
    "Pehli baar TEST karne ke liye '1' likho (sirf is current page ke products - jaldi result mil jayega).\n" +
    "Jab test se satisfy ho jao, sab products ke liye 'all' likho.",
    "1"
  );
  if (pageLimitInput === null) return; // cancelled
  const trimmedLimit = pageLimitInput.trim().toLowerCase();
  const pageLimit = trimmedLimit === "all" ? Infinity : (parseInt(trimmedLimit, 10) || 1);

  const confirmed = confirm(
    `Ye ${pageLimit === Infinity ? "SAARE" : pageLimit} page(s) ke har product ka page ek hidden tab me kholkar Current Stock aur Min Qty scrape karega, phir tab band karke agle product par jayega.\n\n` +
    "Products jitne zyada honge utna time lagega (~5-10 sec/product). Is dauraan ye GeM tab aur browser band mat karna.\n\nContinue karein?"
  );
  if (!confirmed) return;

  isFetchingStock = true;
  isScanning = true;
  const stockBtn = document.getElementById("gem-fetch-stock-btn");
  if (stockBtn) stockBtn.textContent = "⏳ Products scan ho rahe hain...";

  let allRows = [];
  let pageCount = 0;
  const maxPages = Math.min(100, pageLimit);

  while (pageCount < maxPages) {
    const table = findCatalogueTable();
    if (!table) break;
    allRows = allRows.concat(extractCatalogueRows(table));
    pageCount++;

    const previousFirstId = getFirstRowProductId(table);
    const nextLink = findNextPageLink();
    if (!nextLink) break;

    nextLink.click();
    const changed = await waitForPageChange(previousFirstId);
    if (!changed) break;
  }

  if (!allRows.length) {
    showToast("Koi rows nahi mile - cancel", true);
    isFetchingStock = false;
    isScanning = false;
    if (stockBtn) stockBtn.textContent = "📥 Fetch All Stock";
    return;
  }

  chrome.runtime.sendMessage(
    { type: "GEM_FETCH_ALL_STOCK", firmCode, rows: allRows },
    (response) => {
      if (chrome.runtime.lastError) {
        showToast("Extension error: " + chrome.runtime.lastError.message, true);
        isFetchingStock = false;
        isScanning = false;
        if (stockBtn) stockBtn.textContent = "📥 Fetch All Stock";
        return;
      }
      if (!response || !response.started) {
        showToast("Shuru nahi ho paya: " + (response && response.error ? response.error : "unknown error"), true);
        isFetchingStock = false;
        isScanning = false;
        if (stockBtn) stockBtn.textContent = "📥 Fetch All Stock";
      }
      // On success, progress/completion arrive via GEM_STOCK_PROGRESS / GEM_STOCK_DONE below.
    }
  );
}

// Progress updates from the background service worker while fetchAllStockToConsole runs.
chrome.runtime.onMessage.addListener((message) => {
  if (!message) return;

  if (message.type === "GEM_STOCK_PROGRESS") {
    const stockBtn = document.getElementById("gem-fetch-stock-btn");
    if (stockBtn) stockBtn.textContent = `⏳ ${message.index}/${message.total}: ${(message.name || "").slice(0, 20)}`;
  }

  if (message.type === "GEM_STOCK_DONE") {
    isFetchingStock = false;
    isScanning = false;
    const stockBtn = document.getElementById("gem-fetch-stock-btn");
    if (stockBtn) stockBtn.textContent = "📥 Fetch All Stock";
    const extras = [];
    if (message.invalidCount) extras.push(`${message.invalidCount} invalid-marked skipped`);
    if (message.failedCount) extras.push(`${message.failedCount} failed`);
    // Logged (not just toasted) so it doesn't disappear after 4s - check the
    // Console tab (F12) on this GeM page if you missed the toast.
    log(`STOCK FETCH DONE: ${message.successCount}/${message.total} updated, ${message.failedCount} failed, ${message.invalidCount} invalid-skipped`);
    showToast(`✓ Stock fetch complete: ${message.successCount}/${message.total} products updated${extras.length ? ` (${extras.join(", ")})` : ""}`);
  }
});

// ===== Stock Fields Sync (product edit page -> Dev OMS GeM Sync Console) =====

// Detects the per-product "Update Stock" page by its distinctive field labels
// (this page has no stable element IDs to key off, unlike the invoice forms).
function isStockUpdatePage() {
  const text = document.body.textContent;
  return /minimum quantity per consignee/i.test(text) && /current stock/i.test(text);
}

// GeM shows this note on a product's stock page when the seller's stock entry
// has been marked invalid - such products must never be synced to OMS.
function isStockMarkedInvalid() {
  return /stock\s*has\s*been\s*marked\s*invalid/i.test(document.body.textContent);
}

// Finds an <input> whose surrounding row/label text matches labelRegex.
// Walks up from each input a few levels looking for a small (non-giant)
// text block that matches, since GeM doesn't give these fields stable IDs.
function findLabeledInputValue(labelRegex) {
  const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
  for (const input of inputs) {
    let el = input.closest("tr") || input.parentElement;
    let hops = 0;
    while (el && hops < 4) {
      const text = el.textContent.trim();
      if (text.length < 200 && labelRegex.test(text)) {
        return input.value.trim();
      }
      el = el.parentElement;
      hops++;
    }
  }
  return null;
}

// GeM's ProductID looks like "2929237-59245266636" and its Gem Catalogue Id
// looks like "5116877-63572645409-cat". Pull whichever we can find from the
// URL (hash-routed SPA, so the id is usually there) or the page text.
function extractProductIdentifiers() {
  const haystack = window.location.href + " " + document.body.textContent;
  const catalogueIdMatch = haystack.match(/\d{5,}-\d{6,}-cat\b/);
  const productIdMatch = haystack.match(/\b\d{6,}-\d{8,}\b(?!-cat)/);
  return {
    catalogueId: catalogueIdMatch ? catalogueIdMatch[0] : null,
    productId: productIdMatch ? productIdMatch[0] : null
  };
}

async function syncStockToConsole() {
  const stored = await chrome.storage.local.get(["lastFirmCode"]);
  let firmCode = stored.lastFirmCode;
  if (!firmCode) {
    const firmCodeInput = prompt("Ye product kis Firm/Seller account ka hai? (Firm Code likho, jaise MK, VARSH, SS)");
    if (!firmCodeInput || !firmCodeInput.trim()) {
      showToast("Firm code diye bina sync cancel ho gaya.", true);
      return;
    }
    firmCode = firmCodeInput.trim().toUpperCase();
    await chrome.storage.local.set({ lastFirmCode: firmCode });
  }

  if (isStockMarkedInvalid()) {
    showToast("Ye stock 'marked invalid' hai - OMS me sync nahi kiya", true);
    return;
  }

  const { productId, catalogueId } = extractProductIdentifiers();
  if (!productId && !catalogueId) {
    showToast("Product ID / Catalogue Id page par nahi mila - sync cancel", true);
    return;
  }

  const currentStock = findLabeledInputValue(/current\s*stock.*maximum\s*quantity/i);
  const minQtyPerConsignee = findLabeledInputValue(/minimum\s*quantity\s*per\s*consignee/i);

  if (!currentStock && !minQtyPerConsignee) {
    showToast("Stock fields page par nahi mile", true);
    return;
  }

  const btn = document.getElementById("gem-autofill-btn");
  if (btn) btn.textContent = "📤 Stock Sync Console ko bheja ja raha hai...";

  chrome.runtime.sendMessage(
    { type: "GEM_SEND_STOCK", firmCode, productId, catalogueId, currentStock, minQtyPerConsignee },
    (response) => {
      if (btn) btn.textContent = buttonLabelFor("stock");

      if (chrome.runtime.lastError) {
        showToast("Extension error: " + chrome.runtime.lastError.message, true);
        return;
      }
      if (response && response.success) {
        showToast(`✓ ${firmCode}: Stock details Sync Console me bhej diye`);
      } else {
        showToast("Bhejne me fail: " + (response && response.error ? response.error : "unknown error"), true);
      }
    }
  );
}

function fillInvoiceForm() {
  const results = [];

  const contractDate = getContractDate();
  if (contractDate) {
    const okInv = setTextValue("INVOICE_CREATION_FORM-INVOICE_DATE", contractDate);
    const okDisp = setTextValue("INVOICE_CREATION_FORM-DISPATCH_DATE", contractDate);
    results.push((okInv && okDisp) ? `Dates set to ${contractDate}` : "Date fields not found");
  } else {
    results.push("Contract Date page par nahi mila - dates manually daal do");
  }

  // Billing Address - only firm option available, pick first non-placeholder option
  const billAddr = document.getElementById("INVOICE_CREATION_FORM-BILL_ADDR");
  if (billAddr) {
    const firstReal = [...billAddr.options].find(o => o.value !== "-1");
    if (firstReal) {
      billAddr.value = firstReal.value;
      fireEvents(billAddr);
      results.push("Billing Address set");
    }
  }

  const okMode = setSelectValue("INVOICE_CREATION_FORM-DISPATCH_MODE", CONFIG.DISPATCH_MODE);
  results.push(okMode ? `Mode of dispatch: ${CONFIG.DISPATCH_MODE}` : "Mode of dispatch not found");

  // Bank Account - only one real option
  const acct = document.getElementById("INVOICE_CREATION_FORM-ACCOUNT_NUMBER");
  if (acct) {
    const firstReal = [...acct.options].find(o => o.value !== "-1");
    if (firstReal) {
      const wasDisabled = acct.disabled;
      if (wasDisabled) acct.removeAttribute("disabled");
      acct.value = firstReal.value;
      fireEvents(acct);
      if (wasDisabled) acct.setAttribute("disabled", "disabled");
      results.push("Bank Account set");
    }
  }

  const okPOS = setSelectValue("INVOICE_CREATION_FORM-PLACE_OF_SUPPLY", CONFIG.PLACE_OF_SUPPLY);
  results.push(okPOS ? `Place of Supply: ${CONFIG.PLACE_OF_SUPPLY}` : "Place of Supply not found");

  const okState = setSelectValue("INVOICE_CREATION_FORM-PLACE_OF_SUPPLY_STATE_UT", CONFIG.PLACE_OF_SUPPLY_STATE_UT);
  results.push(okState ? `Place of Supply State/UT: ${CONFIG.PLACE_OF_SUPPLY_STATE_UT}` : "State/UT not found");

  log(results.join(" | "));
  showToast(results.join("\n"));
}

// GeM keeps both forms in the DOM even when a tab isn't active (just hidden via CSS),
// so we must check visibility, not just presence, to know which tab is actually showing.
function isVisible(el) {
  return !!el && el.offsetParent !== null;
}

// Which of the known pages/forms is currently on screen?
function detectFormType() {
  const productEl = document.getElementById("INVOICE_ITEMS_FORM-SuppliedQty");
  if (isVisible(productEl)) return "product";

  const invoiceEl = document.getElementById("INVOICE_CREATION_FORM-SELL_INVOICE_NO");
  if (isVisible(invoiceEl)) return "invoice";

  if (isStockUpdatePage()) return "stock";

  if (isCataloguePage()) return "catalogue";

  return null;
}

function handleAutoFillClick() {
  if (!isExtensionContextValid()) {
    warnContextInvalidated();
    return;
  }
  const formType = detectFormType();
  if (formType === "invoice") fillInvoiceForm();
  else if (formType === "product") fillProductForm();
  else if (formType === "catalogue") syncCatalogueToConsole();
  else if (formType === "stock") syncStockToConsole();
  else showToast("Ye page recognize nahi hua", true);
}

function buttonLabelFor(formType) {
  if (formType === "catalogue") return "📤 Send to Sync Console";
  if (formType === "stock") return "📤 Send Stock to Console";
  return "⚡ Auto Fill";
}

function injectButton() {
  const formType = detectFormType();
  if (!formType) return;

  let btn = document.getElementById("gem-autofill-btn");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "gem-autofill-btn";
    btn.type = "button";
    btn.addEventListener("click", handleAutoFillClick);
    document.body.appendChild(btn);
    btnInjected = true;
    log("Button injected for: " + formType);
  }
  if (!isScanning) btn.textContent = buttonLabelFor(formType);

  // Second button, catalogue page only: bulk-fetch stock/min-qty for every product.
  let stockBtn = document.getElementById("gem-fetch-stock-btn");
  let debugBtn = document.getElementById("gem-debug-btn");
  if (formType === "catalogue") {
    if (!stockBtn) {
      stockBtn = document.createElement("button");
      stockBtn.id = "gem-fetch-stock-btn";
      stockBtn.type = "button";
      stockBtn.textContent = "📥 Fetch All Stock";
      stockBtn.addEventListener("click", fetchAllStockToConsole);
      document.body.appendChild(stockBtn);
    }
    if (!debugBtn) {
      debugBtn = document.createElement("button");
      debugBtn.id = "gem-debug-btn";
      debugBtn.type = "button";
      debugBtn.textContent = "🔍 Debug Action Col";
      debugBtn.addEventListener("click", debugDumpActionCells);
      document.body.appendChild(debugBtn);
    }
  } else {
    if (stockBtn && !isFetchingStock) stockBtn.remove();
    if (debugBtn) debugBtn.remove();
  }
}

function removeButtonIfFormGone() {
  const formType = detectFormType();
  const btn = document.getElementById("gem-autofill-btn");
  if (btn && !formType) {
    btn.remove();
    btnInjected = false;
  }
  const stockBtn = document.getElementById("gem-fetch-stock-btn");
  if (stockBtn && formType !== "catalogue" && !isFetchingStock) {
    stockBtn.remove();
  }
  const debugBtn = document.getElementById("gem-debug-btn");
  if (debugBtn && formType !== "catalogue") {
    debugBtn.remove();
  }
}

// GeM is a single-page app (hash based routing) that mutates the DOM heavily
// while rendering. We debounce so our (relatively cheap, but still non-zero)
// checks don't run on every single mutation and slow the page down.
let observerTimer = null;
const observer = new MutationObserver(() => {
  clearTimeout(observerTimer);
  observerTimer = setTimeout(() => {
    injectButton();
    removeButtonIfFormGone();
  }, 400);
});
observer.observe(document.body, { childList: true, subtree: true });

// initial check
injectButton();
