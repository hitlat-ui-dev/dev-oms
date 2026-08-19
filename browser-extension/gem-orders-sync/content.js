// ===== GeM Orders -> Dev OMS Staging Sync =====
// Runs on fulfilment.gem.gov.in's Orders tab. Scrapes contract cards and
// hands them to the background service worker, which POSTs each one to
// Dev OMS's /api/gem-orders staging endpoint (app/dashboard/orders/fetch-gem-orders
// reviews them from there before they're moved into Main Orders).

function log(msg) {
  console.log("[GeM Orders Sync]", msg);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function showToast(message, isError, durationMs = 5000) {
  let toast = document.getElementById("gem-oms-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "gem-oms-toast";
    document.body.appendChild(toast);
  }
  toast.style.background = isError ? "#b3261e" : "#202124";
  toast.textContent = message;
  toast.style.display = "block";
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => {
    toast.style.display = "none";
  }, durationMs);
}

// ===== Firm picker =====
// Shows a dropdown of firms pulled from Dev OMS (companies collection) instead
// of a free-text prompt, so typos can't send orders in under the wrong firm.

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
    overlay.id = "gem-oms-modal-overlay";

    const modal = document.createElement("div");
    modal.id = "gem-oms-modal";

    const title = document.createElement("h3");
    title.textContent = "Ye orders kis Firm ke liye fetch ho rahe hain?";
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
    actions.className = "gem-oms-modal-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "gem-oms-btn-cancel";
    cancelBtn.textContent = "Cancel";

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "gem-oms-btn-confirm";
    confirmBtn.textContent = "Confirm";

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

// Result summary needs to stay on screen until the user reads it and closes
// it themselves - a toast timer isn't good enough here since the fetch can
// finish while they're not looking at the tab.
function showResultModal(title, message, isError) {
  const overlay = document.createElement("div");
  overlay.id = "gem-oms-modal-overlay";

  const modal = document.createElement("div");
  modal.id = "gem-oms-modal";
  modal.className = "gem-oms-modal-lg";

  const heading = document.createElement("h3");
  heading.textContent = title;
  if (isError) heading.style.color = "#b3261e";
  modal.appendChild(heading);

  const body = document.createElement("p");
  body.id = "gem-oms-modal-message";
  body.textContent = message;
  modal.appendChild(body);

  const actions = document.createElement("div");
  actions.className = "gem-oms-modal-actions";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "gem-oms-btn-confirm";
  closeBtn.textContent = "Close";

  actions.appendChild(closeBtn);
  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  closeBtn.addEventListener("click", () => overlay.remove());
  closeBtn.focus();
}

async function pickFirmCode() {
  const stored = await chrome.storage.local.get(["lastFirmCode"]);
  const firms = await getFirmsFromBackground();

  let firmCode;
  if (firms.length) {
    firmCode = await showFirmPickerModal(firms, stored.lastFirmCode || "");
  } else {
    // Backend list fetch failed - fall back to the old free-text prompt.
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

// ===== Order card discovery =====

function findOrderCards() {
  const links = document.querySelectorAll("a[href*='contractId'], a[href*='contract/fds']");
  const cards = [];
  const seen = new Set();
  links.forEach((link) => {
    let card = link.parentElement;
    for (let i = 0; i < 8; i++) {
      if (card && card.innerText && card.innerText.length > 150) break;
      card = card?.parentElement;
    }
    if (card && !seen.has(card)) {
      seen.add(card);
      cards.push({ link, card });
    }
  });
  return cards;
}

function isOrdersPage() {
  return findOrderCards().length > 0;
}

// Orders dated before this are never fetched or saved (per firm's request -
// anything older than 01/04/2026 is out of scope for this sync).
const CUTOFF_DATE = new Date(2026, 3, 1); // month is 0-indexed: 3 = April

function parseContractDate(ddmmyyyy) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((ddmmyyyy || "").trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
}

function isBeforeCutoff(contractDate) {
  const parsed = parseContractDate(contractDate);
  return parsed !== null && parsed < CUTOFF_DATE;
}

// ===== Field extraction =====
// The collapsed order card already shows clean "Label: Value" text for
// everything except the item name, so pull those via label-anchored regex
// instead of guessing - only the item name needs the card expanded first.

function extractOrderFields(cardText, link) {
  const contractNo = link.innerText.trim().replace(/\s+/g, "");
  const contractUrl = link.href || "";

  const dateMatch = cardText.match(/Contract Date\s*:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const contractDate = dateMatch ? dateMatch[1] : "";

  const statusMatch = cardText.match(/Status\s*:\s*([^\n]+)/i);
  const gemStatus = statusMatch ? statusMatch[1].trim() : "";

  const designationMatch = cardText.match(/Buyer Designation\s*:\s*([^\n]+)/i);
  const buyerDesignation = designationMatch ? designationMatch[1].trim() : "";

  const departmentMatch = cardText.match(/Department\s*:\s*([^\n]+)/i);
  const department = departmentMatch ? departmentMatch[1].trim() : "";

  const locationMatch = cardText.match(/Location\s*:\s*([^\n]+)/i);
  const location = locationMatch ? locationMatch[1].trim() : "";

  const totalMatch = cardText.match(/Total order value\s*:?\s*₹?\s*([\d,]+\.?\d*)/i);
  const total = totalMatch ? parseFloat(totalMatch[1].replace(/,/g, "")) : 0;

  const qtyMatch = cardText.match(/Quantity\s*:\s*(\d+)/i);
  const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

  const consigneeMatch = cardText.match(/No\.?\s*of\s*Consignee\s*:\s*(\d+)/i);
  const noOfConsignee = consigneeMatch ? consigneeMatch[1] : "";

  // The actual buyer/ITI name is the Location line itself (e.g. "Govt.
  // industrial training institute, mandvi (surat), ...") - Buyer Designation
  // ("Principal") and Department are separate fields, not the institute name.
  const instituteName = location || [buyerDesignation, department].filter(Boolean).join(" - ") || "GeM Buyer";
  const rate = qty > 0 && total > 0 ? +(total / qty).toFixed(2) : 0;

  return {
    contractNo, contractDate, contractUrl, gemStatus,
    buyerDesignation, department, location,
    total, qty, noOfConsignee, instituteName, rate
  };
}

// The item name and per-unit price live inside a <div class="pad1set"
// style="display:none"> panel that GeM already renders into the DOM - it's
// just hidden via inline CSS until the arrow icon (a plain
// <div class="butpoparrow">, NOT a <button>) is clicked. Since the markup is
// already there, parse it straight out of innerHTML - no click/wait needed.
// Falls back to actually clicking the arrow only if nothing was found (some
// order states may lazy-load this panel instead of pre-rendering it).
function parseHiddenItemPanel(html) {
  const nameMatch = html.match(/col-xs-12 col-sm-8">\s*<p>\s*<b>([^<]+)<\/b>/i);
  let itemName = nameMatch ? nameMatch[1].trim() : "";

  if (!itemName) {
    const imgMatch = html.match(/pbdy-imgitems">\s*<img[^>]*alt="([^"]+)"/i);
    itemName = imgMatch ? imgMatch[1].trim() : "";
  }

  const unitPriceMatch = html.match(/Unit Price:\s*<\/b>\s*<span>\s*₹?\s*([\d,]+\.?\d*)/i);
  const unitPrice = unitPriceMatch ? parseFloat(unitPriceMatch[1].replace(/,/g, "")) : 0;

  return { itemName, unitPrice };
}

async function extractItemDetails(card) {
  let fields = parseHiddenItemPanel(card.innerHTML);
  if (fields.itemName) return fields;

  const arrow = card.querySelector(".butpoparrow");
  if (arrow) {
    arrow.click();
    await sleep(800);
    fields = parseHiddenItemPanel(card.innerHTML);
  }
  return fields;
}

// ===== Pagination =====

function findNextPageLink() {
  const links = Array.from(document.querySelectorAll(".pagination a, ul.pagination a, nav[aria-label*='age'] a"));
  for (const a of links) {
    const li = a.closest("li");
    if (li && (li.classList.contains("disabled") || li.classList.contains("active"))) continue;

    const txt = a.textContent.trim();
    const aria = (a.getAttribute("aria-label") || "").toLowerCase();
    const title = (a.getAttribute("title") || "").toLowerCase();
    const rel = (a.getAttribute("rel") || "").toLowerCase();
    const hasNextIcon = !!a.querySelector("i.fa-angle-right, i.fa-chevron-right, .glyphicon-chevron-right");

    const isNext =
      txt === "›" || txt === "»" || txt === ">" ||
      txt.toLowerCase() === "next" ||
      aria.includes("next") || title.includes("next") ||
      rel === "next" ||
      (li && (li.classList.contains("next") || li.classList.contains("pagination-next"))) ||
      hasNextIcon;

    if (isNext) {
      if (li && li.classList.contains("disabled")) return null;
      return a;
    }
  }
  return null;
}

function getFirstContractNo() {
  const cards = findOrderCards();
  return cards.length ? cards[0].link.innerText.trim() : null;
}

async function waitForPageChange(previousFirst, maxWaitMs = 6000, intervalMs = 300) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await sleep(intervalMs);
    const current = getFirstContractNo();
    if (current && current !== previousFirst) return true;
  }
  return false;
}

// ===== Debug: dump one card's expanded markup to the service worker console =====
// Since F12/right-click Inspect are blocked on this GeM page (managed browser
// policy), this sends the card's HTML to background.js's console instead,
// reachable via chrome://extensions -> this extension's "service worker" link.

async function debugDumpFirstOrderCard() {
  const cards = findOrderCards();
  if (!cards.length) {
    showToast("Koi order card nahi mila", true);
    return;
  }
  const { card } = cards[0];
  const parsed = await extractItemDetails(card);

  chrome.runtime.sendMessage({
    type: "GEM_ORDERS_DEBUG_LOG",
    parsedItemName: parsed.itemName,
    parsedUnitPrice: parsed.unitPrice,
    text: card.innerText,
    html: card.outerHTML
  });
  showToast(`Debug: item = "${parsed.itemName || "(khali)"}" - service worker console me poora detail hai.`);
}

// ===== Main flow =====

let isFetching = false;

// Orders tab is sorted "Contract Date: Latest First", so scanning this many
// pages on every run is enough to catch any order added since the last run -
// no need to ask the user each time or make them re-run with "all".
const PAGES_TO_SCAN = 8;

function sendOneOrder(order, firmCode) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GEM_SEND_ONE_ORDER", order, firmCode }, (response) => {
      if (chrome.runtime.lastError || !response) {
        resolve({ status: "error", error: chrome.runtime.lastError?.message || "no response" });
        return;
      }
      resolve(response);
    });
  });
}

async function fetchAllOrders() {
  if (isFetching) return;

  const firmCode = await pickFirmCode();
  if (!firmCode) {
    showToast("Firm select kiye bina cancel ho gaya.", true);
    return;
  }

  isFetching = true;
  const btn = document.getElementById("gem-oms-fetchall-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Scan ho raha hai...";
  }

  try {
    let allOrders = [];
    let skippedOld = 0;
    let pageCount = 0;
    const maxPages = PAGES_TO_SCAN;

    while (pageCount < maxPages) {
      const cards = findOrderCards();
      if (!cards.length) break;

      for (let i = 0; i < cards.length; i++) {
        const { link, card } = cards[i];
        const fields = extractOrderFields(card.innerText || "", link);
        if (!fields.contractNo) continue;

        // 01/04/2026 se pehle ke order fetch/save nahi karne - skip before
        // even expanding the card (avoids the ~800ms expand wait for these).
        if (isBeforeCutoff(fields.contractDate)) {
          skippedOld++;
          continue;
        }

        if (btn) btn.textContent = `⏳ Page ${pageCount + 1}, order ${i + 1}/${cards.length}...`;
        const { itemName, unitPrice } = await extractItemDetails(card);
        allOrders.push({
          ...fields,
          itemName,
          itemNameRaw: itemName,
          rate: unitPrice || fields.rate
        });
      }

      pageCount++;
      if (pageCount >= maxPages) break;

      const previousFirst = cards[0].link.innerText.trim();
      const nextLink = findNextPageLink();
      if (!nextLink) {
        log(`Stopped after page ${pageCount}: no "next" link found (pagination markup may have changed).`);
        break;
      }

      // GeM's pagination anchors use href="javascript:void(0)" - the actual
      // page-advance happens in a JS click handler, but .click() also makes
      // the browser try to "navigate" to that javascript: URL, which GeM's
      // Content-Security-Policy blocks and logs as an error (harmless to the
      // click handler itself, but noisy/worth avoiding). Swap it for a
      // no-op "#" href first so there's nothing CSP-unsafe to navigate to.
      if (/^javascript:/i.test(nextLink.getAttribute("href") || "")) {
        nextLink.setAttribute("href", "#");
      }
      nextLink.click();
      const changed = await waitForPageChange(previousFirst);
      if (!changed) {
        log(`Stopped after page ${pageCount}: page content didn't change after clicking next.`);
        break;
      }
    }

    if (!allOrders.length) {
      showToast(
        skippedOld
          ? `Koi orders nahi mile (${skippedOld} order 01/04/2026 se pehle ke the, skip kar diye)`
          : "Koi orders nahi mile",
        true
      );
      return;
    }

    let saved = 0;
    let duplicate = 0;
    let error = 0;

    for (let i = 0; i < allOrders.length; i++) {
      if (btn) btn.textContent = `📤 Bhej rahe hain ${i + 1}/${allOrders.length}...`;
      const result = await sendOneOrder(allOrders[i], firmCode);
      if (result.status === "saved") saved++;
      else if (result.status === "duplicate") duplicate++;
      else error++;
      await sleep(150); // gentle gap between requests
    }

    showResultModal(
      "Fetch complete",
      `${saved} naye order saved hue.\n${duplicate} order pehle se fetch/verified the (skip ho gaye).\n${error} order me error aayi.\n${skippedOld} order 01/04/2026 se pehle ke the (fetch/save nahi kiye).\n\n(${pageCount} page${pageCount > 1 ? "s" : ""} scan hui, total ${allOrders.length} order process hue.)`,
      error > 0 && saved === 0 && duplicate === 0
    );
  } finally {
    isFetching = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = "⬇ Fetch GeM Orders (8 pages)";
    }
  }
}

// ===== Button injection =====

function injectButton() {
  if (!isOrdersPage()) return;

  if (!document.getElementById("gem-oms-fetchall-btn")) {
    const btn = document.createElement("button");
    btn.id = "gem-oms-fetchall-btn";
    btn.type = "button";
    btn.textContent = "⬇ Fetch GeM Orders (8 pages)";
    btn.addEventListener("click", fetchAllOrders);
    document.body.appendChild(btn);
    log("Fetch button injected");
  }

  if (!document.getElementById("gem-oms-debug-btn")) {
    const debugBtn = document.createElement("button");
    debugBtn.id = "gem-oms-debug-btn";
    debugBtn.type = "button";
    debugBtn.textContent = "🔍 Debug Order Card";
    debugBtn.addEventListener("click", debugDumpFirstOrderCard);
    document.body.appendChild(debugBtn);
  }
}

function removeButtonIfGone() {
  const btn = document.getElementById("gem-oms-fetchall-btn");
  if (btn && !isOrdersPage() && !isFetching) {
    btn.remove();
  }
  const debugBtn = document.getElementById("gem-oms-debug-btn");
  if (debugBtn && !isOrdersPage()) {
    debugBtn.remove();
  }
}

// GeM is a hash-routed SPA that mutates the DOM heavily while rendering -
// debounce so this doesn't run on every single mutation.
let observerTimer = null;
const observer = new MutationObserver(() => {
  clearTimeout(observerTimer);
  observerTimer = setTimeout(() => {
    injectButton();
    removeButtonIfGone();
  }, 400);
});
observer.observe(document.body, { childList: true, subtree: true });

injectButton();
