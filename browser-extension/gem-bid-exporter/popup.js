(function () {
  "use strict";

  const STORAGE_KEY = "gemBidRows";
  const STATUS_KEY = "gemScanStatus";
  const ACTIVE_CITY_KEY = "gemActiveCity";
  const GEM_URL = "https://bidplus.gem.gov.in/advance-search#tab2";
  const OMS_URL_KEY = "gemOmsUrl";
  const OMS_USER_KEY = "gemOmsUserName";
  // Kept in sync with background.js's DEFAULT_API_BASE - the deployed OMS,
  // not localhost, so a fresh install of this extension points at the real
  // server everyone actually uses without needing to know to change it.
  const DEFAULT_OMS_URL = "https://dev-oms-blush.vercel.app";
  const STATE_KEY = "gemConsigneeState";
  // Item-keyword filters - applied to every row before it's saved anywhere
  // (manual scan, city batch, AND the automated Start-Sync flow triggered
  // from the OMS), via filterRowsByItemKeywords() in content.js. Separate
  // from the OMS's own server-side category exclusion list, which still
  // applies afterwards on top of whatever gets sent.
  const INCLUDE_KEYWORDS_KEY = "gemItemIncludeKeywords";
  const EXCLUDE_KEYWORDS_KEY = "gemItemExcludeKeywords";
  // Best-effort Bid Start Date range filter for the consignee search - see
  // the honesty note on applyBidStartDateFilter() in content.js. Blank by
  // default (skipped entirely), so an install that never touches these two
  // fields behaves exactly as before.
  const DATE_FROM_KEY = "gemBidStartDateFrom";
  const DATE_TO_KEY = "gemBidStartDateTo";

  // Maps this extension's internal row shape to the OMS's gem_bids field keys — kept in
  // sync by hand with app/lib/gemBids/columns.ts in the OMS repo (dev-oms). Mirrors the
  // exact same column set as the Excel export above, just field-keyed instead of positional.
  function mapRowToOmsSchema(r) {
    return {
      bidNo: r.bidNo || "",
      consigneeCity: r.consigneeCity || "",
      bidLink: r.pdfDirectUrl || r.bidLink || "",
      items: r.items || "",
      quantityListing: r.quantity || "",
      departmentNameAndAddress: r.department || "",
      startDate: r.startDate || "",
      bidEndDateTime: r["Bid End Date/Time"] || "",
      documentRequiredFromSeller: r["Document required from seller"] || "",
      bidToRaEnabled: r["Bid to RA enabled"] || "",
      raQualificationRule: r["RA Qualification Rule"] || "",
      typeOfBid: r["Type of Bid"] || "",
      evaluationMethod: r["Evaluation Method"] || "",
      emdAmount: r["EMD Amount"] || "",
      beneficiary: r["Beneficiary :"] || "",
      address: r["Address"] || "",
      buyerAddedBidSpecificAtcUrl: r["Buyer Added Bid Specific ATC"] || "",
    };
  }

  const PDF_FIELD_LABELS = [
    "Bid End Date/Time",
    "Document required from seller",
    "Bid to RA enabled",
    "RA Qualification Rule",
    "Type of Bid",
    "Evaluation Method",
    "EMD Amount",
    "Beneficiary :",
    "Address",
    "Buyer Added Bid Specific ATC",
  ];

  const EXPORT_HEADERS = [
    "Consignee City",
    "Bid No",
    "Bid Link",
    "Items",
    "Quantity (Listing)",
    "Department Name And Address",
    "Start Date",
    ...PDF_FIELD_LABELS,
  ];
  const BID_LINK_COL = EXPORT_HEADERS.indexOf("Bid Link");
  const ATC_COL = EXPORT_HEADERS.indexOf("Buyer Added Bid Specific ATC");
  const ITEMS_COL = EXPORT_HEADERS.indexOf("Items");

  const rowCountEl = document.getElementById("rowCount");
  const scanStateEl = document.getElementById("scanState");
  const statusEl = document.getElementById("status");
  const btnScanFast = document.getElementById("btnScanFast");
  const btnScanPdf = document.getElementById("btnScanPdf");
  const btnAutoAll = document.getElementById("btnAutoAll");
  const btnExport = document.getElementById("btnExport");
  const btnSendOms = document.getElementById("btnSendOms");
  const omsUrlEl = document.getElementById("omsUrl");
  const omsUserNameEl = document.getElementById("omsUserName");
  const btnClear = document.getElementById("btnClear");
  const btnCitySearch = document.getElementById("btnCitySearch");
  const btnCancelBatch = document.getElementById("btnCancelBatch");
  const btnLoadCities = document.getElementById("btnLoadCities");
  const btnDiagnose = document.getElementById("btnDiagnose");
  const debugOutputEl = document.getElementById("debugOutput");
  const consigneeStateEl = document.getElementById("consigneeState");
  const cityListEl = document.getElementById("cityList");
  const includeKeywordsEl = document.getElementById("includeKeywords");
  const excludeKeywordsEl = document.getElementById("excludeKeywords");
  const bidStartDateFromEl = document.getElementById("bidStartDateFrom");
  const bidStartDateToEl = document.getElementById("bidStartDateTo");

  function setBusy(busy) {
    [btnScanFast, btnScanPdf, btnAutoAll, btnExport, btnSendOms, btnClear, btnCitySearch, btnLoadCities, btnDiagnose].forEach(
      (b) => (b.disabled = busy)
    );
  }

  async function loadSettings() {
    const data = await chrome.storage.local.get([
      OMS_URL_KEY,
      OMS_USER_KEY,
      STATE_KEY,
      INCLUDE_KEYWORDS_KEY,
      EXCLUDE_KEYWORDS_KEY,
      DATE_FROM_KEY,
      DATE_TO_KEY,
    ]);
    omsUrlEl.value = data[OMS_URL_KEY] || DEFAULT_OMS_URL;
    omsUserNameEl.value = data[OMS_USER_KEY] || "";
    consigneeStateEl.value = data[STATE_KEY] || "Gujarat";
    includeKeywordsEl.value = data[INCLUDE_KEYWORDS_KEY] || "";
    excludeKeywordsEl.value = data[EXCLUDE_KEYWORDS_KEY] || "";
    bidStartDateFromEl.value = data[DATE_FROM_KEY] || "";
    bidStartDateToEl.value = data[DATE_TO_KEY] || "";
  }
  // Popups can be dismissed (click elsewhere, click the toolbar icon again,
  // Esc) without the field ever losing focus first - and a "change" event
  // only fires on blur. That silently dropped whatever was just typed every
  // time (most noticeably the exclude/include keyword boxes, since those
  // get edited and then the popup just gets closed, not tabbed away from).
  // Saving on every "input" keystroke instead - no debounce - means
  // whatever's in the field is already in storage by the time any close
  // path can tear the popup down, at the cost of one small storage write
  // per keystroke (cheap, and this popup has no other user-typed field
  // sensitive to that).
  function persistOnInput(el, key) {
    const save = () => chrome.storage.local.set({ [key]: el.value.trim() });
    el.addEventListener("input", save);
    el.addEventListener("change", save);
  }
  persistOnInput(omsUrlEl, OMS_URL_KEY);
  persistOnInput(omsUserNameEl, OMS_USER_KEY);
  persistOnInput(consigneeStateEl, STATE_KEY);
  persistOnInput(includeKeywordsEl, INCLUDE_KEYWORDS_KEY);
  persistOnInput(excludeKeywordsEl, EXCLUDE_KEYWORDS_KEY);
  persistOnInput(bidStartDateFromEl, DATE_FROM_KEY);
  persistOnInput(bidStartDateToEl, DATE_TO_KEY);

  async function refreshUI() {
    const data = await chrome.storage.local.get([STORAGE_KEY, STATUS_KEY]);
    const rows = data[STORAGE_KEY] || [];
    const status = data[STATUS_KEY] || null;
    rowCountEl.textContent = String(rows.length);
    if (status && status.scanning) {
      scanStateEl.textContent = "Scanning…";
      scanStateEl.className = "value warn";
      let msg = "";
      if (status.lastAction === "city_batch") {
        if (status.phase === "apply") {
          msg = `${status.cityLabel || "Sending to OMS…"} keep the GeM tab open.`;
        } else {
          const n = (status.cityIndex || 0) + 1;
          const total = status.cityTotal || 1;
          const step = status.phase === "search" ? "opening search" : "scanning pages + PDFs";
          msg = `[${n}/${total}] ${status.cityLabel || ""} — ${step}… keep the GeM tab open.`;
        }
      } else if (status.lastAction === "auto") {
        msg = `Page ${status.page || 1} in progress… keep the GeM tab open.`;
      } else if (status.lastAction === "pdf") {
        msg = "Fetching bid PDFs… this can take a bit per bid.";
      }
      statusEl.textContent = msg;
      setBusy(true);
    } else {
      scanStateEl.textContent = "Idle";
      scanStateEl.className = "value ok";
      if (status && status.lastAction === "city_batch_done") {
        statusEl.textContent = status.omsApplied
          ? `City batch finished — ${status.omsRowCount || 0} bid(s) sent to the OMS.`
          : status.exported
          ? "City batch finished — Excel file downloaded automatically."
          : "City batch finished, but there was nothing to export.";
      } else if (status && status.lastAction === "city_batch_error") {
        scanStateEl.textContent = "Error";
        scanStateEl.className = "value warn";
        statusEl.textContent =
          "City batch stopped due to an error: " +
          (status.errorMessage || "unknown error") +
          " — export what was collected so far, or fix the issue and start again.";
      } else if (status && status.lastAction === "city_batch_cancelled") {
        statusEl.textContent = "City batch cancelled. Export what was collected, or start another batch.";
      } else {
        statusEl.textContent = rows.length
          ? "Ready. Scan more pages or export what you have."
          : "No data yet. Open a GeM bid search results page and scan.";
      }
      setBusy(false);
    }
  }

  async function getActiveGemTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.includes("bidplus.gem.gov.in")) {
      statusEl.textContent = "Open the GeM bid search results page (bidplus.gem.gov.in) first, then try again.";
      statusEl.className = "warn";
      return null;
    }
    return tab;
  }

  async function ensureContentScript(tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { action: "PING" });
      return true;
    } catch (e) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["lib/pdf-extract.js", "lib/xlsx-writer.js", "content.js"],
        });
        return true;
      } catch (e2) {
        statusEl.textContent = "Could not connect to the page. Reload the GeM tab and try again.";
        return false;
      }
    }
  }

  async function sendAction(action) {
    const tab = await getActiveGemTab();
    if (!tab) return;
    const ready = await ensureContentScript(tab.id);
    if (!ready) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { action });
    } catch (e) {
      statusEl.textContent = "Could not start the scan. Reload the GeM tab and try again.";
      return;
    }
    refreshUI();
  }

  async function getOrOpenGemTab() {
    const existing = await chrome.tabs.query({ url: "https://bidplus.gem.gov.in/*" });
    if (existing.length) {
      const tab = existing.find((t) => t.active) || existing[0];
      await chrome.tabs.update(tab.id, { active: true });
      return tab;
    }
    return await chrome.tabs.create({ url: GEM_URL, active: true });
  }

  function waitForTabComplete(tabId, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(false);
      }, timeoutMs);
      function listener(id, info) {
        if (id === tabId && info.status === "complete") {
          if (done) return;
          done = true;
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(true);
        }
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  async function pushCityListToOms(state, cities) {
    const omsUrl = (omsUrlEl.value || DEFAULT_OMS_URL).trim().replace(/\/+$/, "");
    if (!omsUrl) return;
    await fetch(`${omsUrl}/api/gem-bids/cities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, cities }),
    });
  }

  function parseCityList() {
    return (cityListEl.value || "")
      .split(/\r?\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Kicks the batch off and hands it entirely to content.js (RUN_CITY_BATCH),
  // which persists its own progress to chrome.storage.local. That means the
  // batch keeps running on the GeM tab even if this popup is closed or loses
  // focus - refreshUI() below just reads and displays whatever content.js
  // has written to gemScanStatus, the same way it already does for a plain
  // Auto-Scan run.
  async function startCityBatch(state, cities) {
    statusEl.textContent = "Opening the GeM advance search page…";
    const tab = await getOrOpenGemTab();
    if (!tab.url || !tab.url.includes("advance-search")) {
      await chrome.tabs.update(tab.id, { url: GEM_URL });
      await waitForTabComplete(tab.id, 20000);
    }
    const ready = await ensureContentScript(tab.id);
    if (!ready) return;
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: "RUN_CITY_BATCH",
        state,
        cities: cities.length ? cities : [""],
      });
    } catch (e) {
      statusEl.textContent = "Could not start the batch. Reload the GeM tab and try again.";
      return;
    }
    refreshUI();
  }

  btnDiagnose.addEventListener("click", async () => {
    setBusy(true);
    statusEl.textContent = "Reading every dropdown on the page…";
    debugOutputEl.style.display = "none";
    try {
      const tab = await getOrOpenGemTab();
      if (!tab.url || !tab.url.includes("advance-search")) {
        await chrome.tabs.update(tab.id, { url: GEM_URL });
        await waitForTabComplete(tab.id, 20000);
      }
      const ready = await ensureContentScript(tab.id);
      if (!ready) return;
      const result = await chrome.tabs.sendMessage(tab.id, { action: "DEBUG_LIST_SELECTS" });
      if (result && result.ok) {
        const selectLines = (result.selects || []).map(
          (s) =>
            `[select] #${s.index} id="${s.id}" name="${s.name}" class="${s.className}" label="${s.nearbyLabel}" ` +
            `visible=${s.visible} options=${s.optionCount}\n  sample: ${JSON.stringify(s.sampleOptions)}`
        );
        const inputLines = (result.inputs || []).map(
          (inp) =>
            `[input] #${inp.index} id="${inp.id}" name="${inp.name}" type="${inp.type}" placeholder="${inp.placeholder}" ` +
            `class="${inp.className}" label="${inp.nearbyLabel}" visible=${inp.visible}`
        );
        const lines = [...selectLines, ...inputLines];
        debugOutputEl.value = lines.length
          ? lines.join("\n\n")
          : "No <select> or <input> elements found on the page at all.";
        debugOutputEl.style.display = "block";
        debugOutputEl.select();
        statusEl.textContent =
          `Found ${(result.selects || []).length} dropdown(s), ${(result.inputs || []).length} input(s). ` +
          "Copy the text below and share it (useful for fixing the date-range fields if they don't take).";
      } else {
        statusEl.textContent = `Could not read the page (${(result && result.error) || "unknown error"}).`;
      }
    } catch (e) {
      statusEl.textContent = "Could not read the page. Reload the GeM tab and try again.";
    } finally {
      setBusy(false);
    }
  });

  btnLoadCities.addEventListener("click", async () => {
    const state = consigneeStateEl.value || "Gujarat";
    setBusy(true);
    statusEl.textContent = "Opening the GeM advance search page to read the city list…";
    try {
      const tab = await getOrOpenGemTab();
      if (!tab.url || !tab.url.includes("advance-search")) {
        await chrome.tabs.update(tab.id, { url: GEM_URL });
        await waitForTabComplete(tab.id, 20000);
      }
      const ready = await ensureContentScript(tab.id);
      if (!ready) return;
      const result = await chrome.tabs.sendMessage(tab.id, { action: "GET_CITY_LIST", state });
      if (result && result.ok) {
        cityListEl.value = result.cities.join("\n");
        statusEl.textContent = `Loaded ${result.cities.length} cities from GeM for ${state}. Review the list, then click Search + Scan.`;
        // Best-effort: cache this real, freshly-read-from-GeM city list on
        // the OMS so the Start Sync modal's city checkboxes (which the OMS
        // has no other way to populate - bidplus.gem.gov.in blocks
        // non-browser requests) have something accurate to show. A failure
        // here (offline OMS, unusual OMS URL without permission) doesn't
        // affect the city list this popup just loaded, so it's swallowed.
        pushCityListToOms(state, result.cities).catch(() => {});
      } else {
        statusEl.textContent = `Could not read the city list (${(result && result.error) || "unknown error"}). ` +
          "You can still type city names in manually.";
      }
    } catch (e) {
      statusEl.textContent = "Could not read the city list. Reload the GeM tab and try again.";
    } finally {
      setBusy(false);
    }
  });

  btnCitySearch.addEventListener("click", () => {
    const state = consigneeStateEl.value || "Gujarat";
    const cities = parseCityList();
    const label = cities.length ? cities.join(", ") : `ALL cities in ${state}`;
    const ok = confirm(
      `This will search and auto-scan (list pages + PDFs) for: ${label}.\n\n` +
        `It runs on the GeM tab itself, so you can close this popup once it starts - just don't close the ` +
        `GeM tab. This can take a while, especially for multiple cities or "all cities". Continue?`
    );
    if (ok) startCityBatch(state, cities);
  });

  btnCancelBatch.addEventListener("click", async () => {
    const tabs = await chrome.tabs.query({ url: "https://bidplus.gem.gov.in/*" });
    if (!tabs.length) {
      statusEl.textContent = "No GeM tab found to cancel.";
      return;
    }
    try {
      await chrome.tabs.sendMessage(tabs[0].id, { action: "CANCEL_CITY_BATCH" });
    } catch (e) {
      /* tab may be between page loads - the running batch will still see running:false on its next storage check */
    }
    statusEl.textContent = "Cancelling… stops after the results page currently in progress.";
  });

  btnScanFast.addEventListener("click", () => sendAction("SCAN_PAGE_FAST"));
  btnScanPdf.addEventListener("click", () => sendAction("SCAN_PAGE_WITH_PDF"));
  btnAutoAll.addEventListener("click", () => {
    const ok = confirm(
      "This will click through every results page and fetch every bid's PDF. It can take a while for 90+ records " +
        "and the GeM tab must stay open and in front. Continue?"
    );
    if (ok) sendAction("AUTO_SCAN_ALL");
  });

  btnClear.addEventListener("click", async () => {
    const ok = confirm("Clear all saved bid rows collected so far?");
    if (!ok) return;
    await chrome.storage.local.set({ [STORAGE_KEY]: [], [STATUS_KEY]: null, [ACTIVE_CITY_KEY]: null });
    refreshUI();
  });

  btnExport.addEventListener("click", async () => {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const rows = data[STORAGE_KEY] || [];
    if (!rows.length) {
      statusEl.textContent = "Nothing to export yet - scan a page first.";
      return;
    }
    const outRows = rows.map((r) => [
      r.consigneeCity || "",
      r.bidNo || "",
      r.pdfDirectUrl || r.bidLink || "",
      r.items || "",
      r.quantity || "",
      r.department || "",
      r.startDate || "",
      ...PDF_FIELD_LABELS.map((label) => r[label] || ""),
    ]);
    const HIGHLIGHT_ITEM_TERM = "paper-based printing services";
    const highlightRows = new Set();
    outRows.forEach((row, i) => {
      if ((row[ITEMS_COL] || "").toLowerCase().includes(HIGHLIGHT_ITEM_TERM)) highlightRows.add(i);
    });
    const bytes = buildXlsx(EXPORT_HEADERS, outRows, {
      highlightRows,
      hyperlinkColumns: [BID_LINK_COL, ATC_COL],
    });
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const a = document.createElement("a");
    a.href = url;
    a.download = `gem_bids_${stamp}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });

  btnSendOms.addEventListener("click", async () => {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const rows = data[STORAGE_KEY] || [];
    if (!rows.length) {
      statusEl.textContent = "Nothing to send yet - scan a page first.";
      return;
    }

    let omsUrl = (omsUrlEl.value || "").trim().replace(/\/+$/, "");
    if (!omsUrl) {
      statusEl.textContent = "Enter your OMS server URL first (e.g. http://localhost:3000).";
      return;
    }
    if (!/^https?:\/\//i.test(omsUrl)) omsUrl = "http://" + omsUrl;
    await chrome.storage.local.set({ [OMS_URL_KEY]: omsUrl, [OMS_USER_KEY]: (omsUserNameEl.value || "").trim() });

    let origin;
    try {
      origin = new URL(omsUrl).origin + "/*";
    } catch (e) {
      statusEl.textContent = "That doesn't look like a valid URL.";
      return;
    }

    setBusy(true);
    statusEl.textContent = "Requesting permission to reach your OMS…";
    try {
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) {
        statusEl.textContent = "Permission denied - can't send to the OMS without it.";
        return;
      }

      statusEl.textContent = `Sending ${rows.length} bid(s) to the OMS…`;
      const res = await fetch(`${omsUrl}/api/gem-bids/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: rows.map(mapRowToOmsSchema),
          fileName: "",
          userName: (omsUserNameEl.value || "").trim(),
          source: "extension_direct",
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || `Server responded ${res.status}`);
      statusEl.textContent =
        `Sent to OMS: ${result.newCount} New Published, ${result.updatedCount} Updated/Extended, ${result.oldCount} Old.`;
    } catch (e) {
      statusEl.textContent = "Could not reach the OMS: " + (e && e.message ? e.message : "unknown error") +
        " - check the URL and that the server is running.";
    } finally {
      setBusy(false);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes[STORAGE_KEY] || changes[STATUS_KEY])) refreshUI();
  });

  loadSettings();
  refreshUI();
})();
