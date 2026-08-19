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

// ===== Firm picker (dropdown sourced from Dev OMS, not a free-text prompt) =====

function getFirmsFromBackground() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GEM_GET_FIRMS" }, (response) => {
      if (chrome.runtime.lastError || !response || !response.ok) {
        resolve([]);
        return;
      }
      resolve(response.firms);
    });
  });
}

function showFirmPickerModal(firms, lastFirmCode) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = "gem-cat-modal-overlay";

    const modal = document.createElement("div");
    modal.id = "gem-cat-modal";

    const title = document.createElement("h3");
    title.textContent = "Ye catalogue kis Firm/Seller account ka hai?";
    modal.appendChild(title);

    const select = document.createElement("select");
    firms.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.firmCode;
      opt.textContent = f.firmName ? `${f.firmCode} - ${f.firmName}` : f.firmCode;
      if (f.firmCode === lastFirmCode) opt.selected = true;
      select.appendChild(opt);
    });
    modal.appendChild(select);

    const actions = document.createElement("div");
    actions.className = "gem-cat-modal-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "gem-cat-btn-cancel";
    cancelBtn.textContent = "Cancel";

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "gem-cat-btn-confirm";
    confirmBtn.textContent = "Next →";

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const close = (result) => {
      overlay.remove();
      resolve(result);
    };
    cancelBtn.addEventListener("click", () => close(null));
    confirmBtn.addEventListener("click", () => close(select.value));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(null);
    });
  });
}

async function pickFirmCode() {
  const stored = await chrome.storage.local.get(["lastFirmCode"]);
  const firms = await getFirmsFromBackground();

  let firmCode;
  if (firms.length) {
    firmCode = await showFirmPickerModal(firms, stored.lastFirmCode || "");
  } else {
    const typed = prompt(
      "Firm list load nahi ho payi. Firm Code likho (jaise MK, VARSH, SS):",
      stored.lastFirmCode || ""
    );
    firmCode = typed ? typed.trim().toUpperCase() : null;
  }

  if (!firmCode) return null;
  await chrome.storage.local.set({ lastFirmCode: firmCode });
  return firmCode;
}

// ===== Page-range picker =====
// Returns a positive integer, Infinity (for "All"), or null if cancelled.

function showPageRangeModal() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = "gem-cat-modal-overlay";

    const modal = document.createElement("div");
    modal.id = "gem-cat-modal";

    const title = document.createElement("h3");
    title.textContent = "Kitne catalogue pages process karne hain?";
    modal.appendChild(title);

    const row = document.createElement("div");
    row.className = "gem-cat-page-row";

    const input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.value = "1";
    row.appendChild(input);

    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "gem-cat-all-btn";
    allBtn.textContent = "All Pages";
    row.appendChild(allBtn);
    modal.appendChild(row);

    let useAll = false;
    allBtn.addEventListener("click", () => {
      useAll = !useAll;
      allBtn.classList.toggle("active", useAll);
      input.disabled = useAll;
    });

    const actions = document.createElement("div");
    actions.className = "gem-cat-modal-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "gem-cat-btn-cancel";
    cancelBtn.textContent = "Cancel";

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "gem-cat-btn-confirm";
    confirmBtn.textContent = "Start Sync";

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const close = (result) => {
      overlay.remove();
      resolve(result);
    };
    cancelBtn.addEventListener("click", () => close(null));
    confirmBtn.addEventListener("click", () => {
      if (useAll) {
        close(Infinity);
        return;
      }
      const n = parseInt(input.value, 10);
      close(n > 0 ? n : 1);
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(null);
    });
    input.focus();
  });
}

// ===== Progress box (stays visible for the whole run, updated live) =====

function showProgressModal(initialText) {
  const overlay = document.createElement("div");
  overlay.id = "gem-cat-modal-overlay";

  const modal = document.createElement("div");
  modal.id = "gem-cat-modal";
  modal.className = "gem-cat-modal-lg";

  const title = document.createElement("h3");
  title.textContent = "Sync chal raha hai...";
  modal.appendChild(title);

  const track = document.createElement("div");
  track.className = "gem-cat-progress-track";
  const fill = document.createElement("div");
  fill.className = "gem-cat-progress-fill";
  track.appendChild(fill);
  modal.appendChild(track);

  const body = document.createElement("p");
  body.id = "gem-cat-modal-message";
  body.textContent = initialText;
  modal.appendChild(body);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  return {
    update(text, percent) {
      body.textContent = text;
      if (typeof percent === "number") fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    },
    close() {
      overlay.remove();
    }
  };
}

// Result summary needs to stay on screen until the user reads it and closes
// it themselves - a toast timer isn't good enough here since a big sync can
// finish while they're not looking at the tab.
function showResultModal(title, message, isError) {
  const overlay = document.createElement("div");
  overlay.id = "gem-cat-modal-overlay";

  const modal = document.createElement("div");
  modal.id = "gem-cat-modal";
  modal.className = "gem-cat-modal-lg";

  const heading = document.createElement("h3");
  heading.textContent = title;
  if (isError) heading.style.color = "#b3261e";
  modal.appendChild(heading);

  const body = document.createElement("p");
  body.id = "gem-cat-modal-message";
  body.textContent = message;
  modal.appendChild(body);

  const actions = document.createElement("div");
  actions.className = "gem-cat-modal-actions";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "gem-cat-btn-confirm";
  closeBtn.textContent = "Close";

  actions.appendChild(closeBtn);
  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  closeBtn.addEventListener("click", () => overlay.remove());
  closeBtn.focus();
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

// Wraps the GEM_FETCH_ALL_STOCK message + the GEM_STOCK_PROGRESS/GEM_STOCK_DONE
// event pair (background.js reports progress via separate runtime messages,
// not the sendMessage callback, since the whole scan can take minutes) as a
// single awaitable promise, so runMergedSync() below can just `await` the
// stock-fetch phase like any other async step.
let activeStockFetchResolve = null;
let activeProgressModal = null;

function fetchStockForRows(firmCode, rows) {
  return new Promise((resolve, reject) => {
    activeStockFetchResolve = resolve;
    chrome.runtime.sendMessage(
      { type: "GEM_FETCH_ALL_STOCK", firmCode, rows },
      (response) => {
        if (chrome.runtime.lastError) {
          activeStockFetchResolve = null;
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response || !response.started) {
          activeStockFetchResolve = null;
          reject(new Error((response && response.error) || "unknown error"));
        }
        // else: resolves later, when GEM_STOCK_DONE arrives below.
      }
    );
  });
}

// Progress updates from the background service worker while a stock fetch runs.
chrome.runtime.onMessage.addListener((message) => {
  if (!message) return;

  if (message.type === "GEM_STOCK_PROGRESS" && activeProgressModal) {
    // Stock-fetch is the second half of the merged flow's progress bar (the
    // catalogue-scan phase already used the first 0-50%).
    const pct = 50 + Math.round((message.index / message.total) * 50);
    activeProgressModal.update(`Stock fetch: ${message.index}/${message.total} - ${(message.name || "").slice(0, 40)}`, pct);
  }

  if (message.type === "GEM_STOCK_DONE") {
    log(`STOCK FETCH DONE: ${message.successCount}/${message.total} updated, ${message.failedCount} failed, ${message.invalidCount} invalid-skipped`);
    if (activeStockFetchResolve) {
      const resolve = activeStockFetchResolve;
      activeStockFetchResolve = null;
      resolve(message);
    }
  }
});

let isMergedSyncRunning = false;

// Merged flow: scans the catalogue listing (Name/Category/Brand/etc, sent to
// save_catalogue_links) AND fetches every scanned product's Current Stock /
// Min Qty (sent to save_stock_fields) in one pass. Previously two separate
// buttons that could each scan a different subset of products on different
// runs - combined with a since-fixed id-matching bug, that's what created
// the "No link" / missing-info duplicate rows seen on the OMS Catalogue page.
// Doing both in one pass over the SAME scanned rows avoids that entirely.
async function runMergedSync() {
  if (isMergedSyncRunning) return;
  if (!isExtensionContextValid()) {
    warnContextInvalidated();
    return;
  }

  const firmCode = await pickFirmCode();
  if (!firmCode) {
    showToast("Firm select kiye bina cancel ho gaya.", true);
    return;
  }

  const pageLimit = await showPageRangeModal();
  if (pageLimit === null) return; // cancelled

  isMergedSyncRunning = true;
  isScanning = true;
  const progress = showProgressModal("Catalogue scan shuru ho raha hai...");
  activeProgressModal = progress;

  try {
    // Phase 1 (0-40%): scan the catalogue listing pages.
    let allRows = [];
    let pageCount = 0;
    const maxPages = Math.min(100, pageLimit);

    while (pageCount < maxPages) {
      const table = findCatalogueTable();
      if (!table) break;
      progress.update(`Catalogue page ${pageCount + 1} scan ho raha hai...`, Math.round((pageCount / maxPages) * 40));

      allRows = allRows.concat(extractCatalogueRows(table));
      pageCount++;

      const previousFirstId = getFirstRowProductId(table);
      const nextLink = findNextPageLink();
      if (!nextLink) break;

      // GeM's pagination anchors use href="javascript:void(0)" - .click() also
      // makes the browser try to "navigate" to that URL, which GeM's CSP
      // blocks and logs as an error. Swap it for a no-op "#" href first.
      if (/^javascript:/i.test(nextLink.getAttribute("href") || "")) {
        nextLink.setAttribute("href", "#");
      }
      nextLink.click();
      const changed = await waitForPageChange(previousFirstId);
      if (!changed) break;
    }

    if (!allRows.length) {
      progress.close();
      activeProgressModal = null;
      showResultModal("Sync Failed", "Koi products nahi mile - catalogue table detect nahi hua ya khali tha.", true);
      return;
    }

    // Phase 2 (~45%): send catalogue listing info (Name/Category/Brand/etc).
    progress.update(
      `${allRows.length} products mile (${pageCount} page${pageCount > 1 ? "s" : ""}). Catalogue info Sync Console ko bhej rahe hain...`,
      45
    );
    const catalogueResult = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GEM_SEND_CATALOGUE", rows: allRows, firmCode }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { success: false, error: "no response" });
      });
    });

    // Phase 3 (50-100%): fetch Current Stock / Min Qty for every product just
    // scanned - the SAME rows array, so the two never drift out of sync.
    progress.update("Ab har product ka Current Stock / Min Qty fetch ho raha hai... (~5-10 sec/product)", 50);
    let stockResult = null;
    try {
      stockResult = await fetchStockForRows(firmCode, allRows);
    } catch (err) {
      log("Stock fetch phase failed to start: " + (err && err.message ? err.message : err));
    }

    progress.close();
    activeProgressModal = null;

    const lines = [
      `${allRows.length} products scan hue (${pageCount} page${pageCount > 1 ? "s" : ""}).`,
      catalogueResult.success
        ? `Catalogue info: ${catalogueResult.count ?? allRows.length} products Sync Console me save hue.`
        : `Catalogue info save karne me error: ${catalogueResult.error || "unknown"}`
    ];
    if (stockResult) {
      const extras = [];
      if (stockResult.invalidCount) extras.push(`${stockResult.invalidCount} invalid-marked skipped`);
      lines.push(
        `Stock/Min Qty: ${stockResult.successCount}/${stockResult.total} updated, ${stockResult.failedCount} failed${extras.length ? ` (${extras.join(", ")})` : ""}.`
      );
    } else {
      lines.push("Stock/Min Qty fetch shuru nahi ho paya (extension error).");
    }

    showResultModal("Sync Complete", lines.join("\n"), !catalogueResult.success && !stockResult);
  } catch (err) {
    progress.close();
    activeProgressModal = null;
    if (!isExtensionContextValid()) warnContextInvalidated();
    else showResultModal("Sync Failed", "Error: " + (err && err.message ? err.message : err), true);
  } finally {
    isMergedSyncRunning = false;
    isScanning = false;
  }
}

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
  // Current Stock / Min Qty Per Consignee are numeric fields - GeM renders
  // them as <input type="number">, which the old text-only selector below
  // silently excluded (found the label text fine, "isReady" passed, but
  // never found a matching input to read .value from). Match any real text
  // input regardless of type, just excluding non-data input kinds.
  const inputs = document.querySelectorAll(
    'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="file"])'
  );
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
// looks like "5116877-63572645409-cat" (different prefix, different number -
// two separate ids). The product-edit page's own URL is
// "...catalog/new?id=<ProductID>-cat&bnid=..." - the id param LOOKS like a
// catalogue id (same "-cat" suffix shape) but is actually the ProductID with
// a literal "-cat" appended by GeM's own routing convention, not the real
// Gem Catalogue Id. Confirmed by comparing scraped values against the
// listing table: the id found here always carries the ProductID prefix
// (matches ProductID.text already stored from the catalogue scan), never
// the Gem Catalogue Id prefix - so it must be matched against ProductID,
// not catalogueId, or save_stock_fields never finds the row it should
// update and silently creates a duplicate/orphan row instead.
function extractProductIdentifiers() {
  const haystack = window.location.href + " " + document.body.textContent;
  const idMatch = haystack.match(/\d{5,}-\d{6,}-cat\b/);
  const productId = idMatch ? idMatch[0].replace(/-cat$/, "") : null;
  return { catalogueId: null, productId };
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
  else if (formType === "catalogue") runMergedSync();
  else if (formType === "stock") syncStockToConsole();
  else showToast("Ye page recognize nahi hua", true);
}

function buttonLabelFor(formType) {
  if (formType === "catalogue") return "🔄 Sync Catalogue + Stock";
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

  // Debug button, catalogue page only.
  let debugBtn = document.getElementById("gem-debug-btn");
  if (formType === "catalogue") {
    if (!debugBtn) {
      debugBtn = document.createElement("button");
      debugBtn.id = "gem-debug-btn";
      debugBtn.type = "button";
      debugBtn.textContent = "🔍 Debug Action Col";
      debugBtn.addEventListener("click", debugDumpActionCells);
      document.body.appendChild(debugBtn);
    }
  } else if (debugBtn) {
    debugBtn.remove();
  }
}

function removeButtonIfFormGone() {
  const formType = detectFormType();
  const btn = document.getElementById("gem-autofill-btn");
  if (btn && !formType && !isScanning) {
    btn.remove();
    btnInjected = false;
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
