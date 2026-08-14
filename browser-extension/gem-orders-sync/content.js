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

function showToast(message, isError) {
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
  }, 5000);
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

async function fetchAllOrders() {
  if (isFetching) return;

  const stored = await chrome.storage.local.get(["lastFirmCode"]);
  const firmCodeInput = prompt(
    "Ye orders kis Firm ke liye fetch ho rahe hain? (Firm Code likho, jaise MK, VARSH, SS)",
    stored.lastFirmCode || ""
  );
  if (!firmCodeInput || !firmCodeInput.trim()) {
    showToast("Firm code diye bina cancel ho gaya.", true);
    return;
  }
  const firmCode = firmCodeInput.trim().toUpperCase();
  await chrome.storage.local.set({ lastFirmCode: firmCode });

  const pageLimitInput = prompt(
    "Kitne pages process karne hain?\n\n" +
    "Pehli baar TEST karne ke liye '1' likho (sirf is current page ke orders).\n" +
    "Jab test se satisfy ho jao, sab orders ke liye 'all' likho.",
    "1"
  );
  if (pageLimitInput === null) return;
  const trimmedLimit = pageLimitInput.trim().toLowerCase();
  const pageLimit = trimmedLimit === "all" ? Infinity : (parseInt(trimmedLimit, 10) || 1);

  isFetching = true;
  const btn = document.getElementById("gem-oms-fetchall-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Scan ho raha hai...";
  }

  try {
    let allOrders = [];
    let pageCount = 0;
    const maxPages = Math.min(100, pageLimit);

    while (pageCount < maxPages) {
      const cards = findOrderCards();
      if (!cards.length) break;

      for (let i = 0; i < cards.length; i++) {
        const { link, card } = cards[i];
        const fields = extractOrderFields(card.innerText || "", link);
        if (!fields.contractNo) continue;

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
      const previousFirst = cards[0].link.innerText.trim();
      const nextLink = findNextPageLink();
      if (!nextLink) break;

      nextLink.click();
      const changed = await waitForPageChange(previousFirst);
      if (!changed) break;
    }

    if (!allOrders.length) {
      showToast("Koi orders nahi mile", true);
      return;
    }

    if (btn) btn.textContent = `📤 ${allOrders.length} orders bhej rahe hain...`;

    chrome.runtime.sendMessage(
      { type: "GEM_SEND_ORDERS", firmCode, orders: allOrders },
      (response) => {
        if (chrome.runtime.lastError) {
          showToast("Extension error: " + chrome.runtime.lastError.message, true);
          return;
        }
        if (response && response.done) {
          showToast(
            `✓ ${response.saved} saved, ${response.duplicate} already fetched, ${response.error} error (${pageCount} page${pageCount > 1 ? "s" : ""})`
          );
        } else {
          showToast("Bhejne me fail: " + (response && response.error ? response.error : "unknown error"), true);
        }
      }
    );
  } finally {
    isFetching = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = "⬇ Fetch GeM Orders";
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
    btn.textContent = "⬇ Fetch GeM Orders";
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
