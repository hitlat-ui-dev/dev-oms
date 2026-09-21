/*
 * Runs on bidplus.gem.gov.in. Scrapes the bid list shown on the page,
 * optionally paginates through all result pages, and optionally fetches
 * + parses each bid's PDF document for a fixed set of fields. Everything
 * it finds is written incrementally to chrome.storage.local so progress
 * survives the popup being closed - only the GeM tab needs to stay open.
 */
(function () {
  "use strict";

  const STORAGE_KEY = "gemBidRows";
  const STATUS_KEY = "gemScanStatus";
  // Set by RUN_CONSIGNEE_SEARCH (or by the popup before a scan) so every
  // row saved while it's active gets tagged with the city that was
  // searched for. This is deliberately NOT scraped off the bid card or
  // PDF - the listing cards don't reliably show it and the PDF's own
  // consignee table can't be reconstructed cleanly (see README) - so the
  // city you searched for is the trustworthy source of truth instead.
  const ACTIVE_CITY_KEY = "gemActiveCity";
  // Persisted state machine for a multi-city batch run (see
  // runBatchStepIfActive below). Living in storage - not a plain JS
  // variable - is what lets a batch survive both the popup being closed
  // AND a full page reload/navigation triggered by submitting the
  // search form, whichever this site actually does.
  const CITY_BATCH_KEY = "gemCityBatch";

  // Item-keyword filters, read fresh from storage by filterRowsByItemKeywords()
  // below and applied to every row before it's saved anywhere - manual scans,
  // city batches, AND OMS-triggered city batches (an omsRunId-tagged batch -
  // see runBatchStepIfActive/autoScanAllPages further down) all funnel
  // through it, so a keyword typed once in the popup is respected everywhere
  // regardless of which flow found the row. This is in addition to - not a
  // replacement for - the OMS's own server-side category exclusion list
  // (lib/gemBids/exclusionKeywords.json), which still runs afterwards on
  // whatever gets sent.
  const INCLUDE_KEYWORDS_KEY = "gemItemIncludeKeywords";
  const EXCLUDE_KEYWORDS_KEY = "gemItemExcludeKeywords";
  const BID_START_DATE_FROM_KEY = "gemBidStartDateFrom";
  const BID_START_DATE_TO_KEY = "gemBidStartDateTo";

  // Row accumulator used only while a city batch is driving an OMS-triggered
  // run (batch.omsRunId set) - kept separate from STORAGE_KEY (gemBidRows,
  // the popup's own manual scan data) so an OMS-driven run never mixes with
  // or gets sent alongside whatever the user is separately collecting by
  // hand. Cleared once the run is applied. Written by background.js too (it
  // reads/clears CLAIMED_RUN_KEY, the shared "a batch is already being
  // driven for some run" lock between this script and background.js's
  // periodic poll).
  const OMS_BATCH_ROWS_KEY = "gemOmsBatchRows";
  const CLAIMED_RUN_KEY = "gemBgClaimedRunId";

  // English fragments of the bilingual field labels requested for the
  // PDF detail extraction. Devanagari text in these PDFs frequently comes
  // through garbled from naive extraction (missing conjuncts), so
  // matching is done on the English half of each label, which normally
  // survives intact. If GeM changes their PDF template wording, tweak
  // these strings to match.
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

  const LISTING_LABELS = ["Items:", "Quantity:", "Department Name And Address:", "Start Date:", "End Date:"];

  // For this field, only the actual "Click here to view the file" hyperlink
  // target is wanted in the export - not the surrounding sentence, and not
  // the disclaimer paragraph that follows it. pdf-extract.js tags every
  // page's clickable-link URLs onto that page's text (see LINK_MARK in
  // lib/pdf-extract.js) and returns them back as "<label>__links" alongside
  // the plain-text fields. When a bid's PDF has a real link annotation for
  // this field, that URL is what goes in the cell. Many GeM bid PDFs don't
  // actually embed a real link here at all (the download is a JavaScript
  // action on GeM's website, not something written into the static PDF) -
  // in that case the cell is left blank rather than showing any text,
  // since a plain sentence isn't what was asked for.
  const ATC_LABEL = "Buyer Added Bid Specific ATC";

  // Mirrors popup.js's EXPORT_HEADERS/export mapping exactly, so a batch
  // finishing on its own (GeM tab open, popup closed) produces the same
  // file a manual "Export to Excel" click would. Consignee City is first,
  // ahead of Bid No, per how the sheet is meant to read. End Date and PDF
  // Status columns removed on request.
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
  const ATC_COL = EXPORT_HEADERS.indexOf(ATC_LABEL);
  const ITEMS_COL = EXPORT_HEADERS.indexOf("Items");

  async function exportRowsToXlsx(filenameTag) {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const rows = data[STORAGE_KEY] || [];
    if (!rows.length) return false;
    const outRows = rows.map((r) => [
      r.consigneeCity || "",
      r.bidNo || "",
      // Prefer the actual resolved PDF URL (set once fetchAndParsePdf has
      // found/confirmed it - see pdfDirectUrl below) so clicking this cell
      // in Excel goes straight to the document instead of the bid's
      // listing page. Falls back to the listing page link when the PDF
      // couldn't be resolved (captcha/not-a-pdf/error), so the cell is
      // never empty.
      r.pdfDirectUrl || r.bidLink || "",
      r.items || "",
      r.quantity || "",
      r.department || "",
      r.startDate || "",
      ...PDF_FIELD_LABELS.map((label) => r[label] || ""),
    ]);
    // Kept in sync with the identical logic in popup.js's manual export handler.
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
    a.download = `gem_bids_${filenameTag ? filenameTag + "_" : ""}${stamp}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function findBidCards() {
    const anchors = Array.from(document.querySelectorAll("a")).filter((a) =>
      /^GEM\/\d{4}\/[A-Za-z]\/\d+$/.test((a.textContent || "").trim())
    );
    const cards = [];
    const seen = new Set();
    for (const a of anchors) {
      let el = a;
      let container = null;
      for (let depth = 0; depth < 8 && el; depth++) {
        el = el.parentElement;
        if (!el) break;
        const txt = el.innerText || "";
        if (txt.includes("Start Date") && txt.includes("End Date") && txt.includes("Items")) {
          container = el;
          break;
        }
      }
      if (!container || seen.has(container)) continue;
      seen.add(container);
      cards.push({ containerEl: container, bidNo: a.textContent.trim(), bidLink: a.href });
    }
    return cards;
  }

  function scanCurrentPage() {
    const cards = findBidCards();
    return cards.map((card) => {
      const fields = extractFieldsFromText(card.containerEl.innerText, LISTING_LABELS);
      return {
        bidNo: card.bidNo,
        bidLink: card.bidLink,
        items: fields["Items:"] || "",
        quantity: fields["Quantity:"] || "",
        department: fields["Department Name And Address:"] || "",
        startDate: fields["Start Date:"] || "",
        endDate: fields["End Date:"] || "",
      };
    });
  }

  function parseKeywordList(raw) {
    return (raw || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }

  // Include-list wins over nothing (blank include = "everything passes"),
  // exclude-list always removes a match regardless of include. Both blank
  // is a no-op (returns rows unchanged) so an install that never touches
  // these two popup fields behaves exactly as before this filter existed.
  async function filterRowsByItemKeywords(rows) {
    const data = await chrome.storage.local.get([INCLUDE_KEYWORDS_KEY, EXCLUDE_KEYWORDS_KEY]);
    const include = parseKeywordList(data[INCLUDE_KEYWORDS_KEY]);
    const exclude = parseKeywordList(data[EXCLUDE_KEYWORDS_KEY]);
    if (!include.length && !exclude.length) return rows;
    return rows.filter((row) => {
      const items = (row.items || "").toLowerCase();
      if (include.length && !include.some((kw) => items.includes(kw))) return false;
      if (exclude.length && exclude.some((kw) => items.includes(kw))) return false;
      return true;
    });
  }

  function findNextControl() {
    const candidates = Array.from(document.querySelectorAll("a, button, li, span"));
    for (const el of candidates) {
      const t = (el.textContent || "").trim().toLowerCase();
      const ariaLabel = (el.getAttribute("aria-label") || "").toLowerCase();
      if (t === "next" || t === "»" || t === ">" || ariaLabel.includes("next")) {
        const cls = (el.className || "").toString().toLowerCase();
        if (cls.includes("disabled")) continue;
        if (el.getAttribute("aria-disabled") === "true") continue;
        return el;
      }
    }
    return null;
  }

  async function waitForListChange(prevFirstBidNo, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await sleep(300);
      const cards = findBidCards();
      if (cards.length && cards[0].bidNo !== prevFirstBidNo) return true;
    }
    return false;
  }

  async function fetchAndParsePdf(url, labels) {
    try {
      const resp = await fetch(url, { credentials: "include" });
      if (!resp.ok) return { status: "http_" + resp.status, fields: {}, pdfUrl: "" };
      const ct = (resp.headers.get("content-type") || "").toLowerCase();

      if (ct.includes("pdf")) {
        const buf = await resp.arrayBuffer();
        const { fields } = await extractBidPdfFields(buf, labels);
        return { status: "ok", fields, pdfUrl: url };
      }

      // Not a direct PDF - likely an interim HTML page. Look for a real
      // PDF link inside it (GeM sometimes wraps documents behind a
      // viewer/download page, occasionally gated by a captcha we can't
      // solve here).
      const html = await resp.text();
      if (/captcha/i.test(html)) return { status: "captcha_blocked", fields: {}, pdfUrl: "" };
      const m =
        html.match(/href=["']([^"']+\.pdf[^"']*)["']/i) ||
        html.match(/href=["']([^"']*(?:showbiddocument|ShowBidDocument|showBidDocument)[^"']*)["']/i);
      if (m) {
        const pdfUrl = new URL(m[1], url).href;
        const resp2 = await fetch(pdfUrl, { credentials: "include" });
        const ct2 = (resp2.headers.get("content-type") || "").toLowerCase();
        if (resp2.ok && ct2.includes("pdf")) {
          const buf2 = await resp2.arrayBuffer();
          const { fields } = await extractBidPdfFields(buf2, labels);
          // This resolved pdfUrl is what actually served real PDF bytes
          // (confirmed by content-type above) - it's what gets saved as
          // the Bid Link column's direct-download target, in place of the
          // original listing-page link.
          return { status: "ok", fields, pdfUrl };
        }
      }
      return { status: "not_pdf", fields: {}, pdfUrl: "" };
    } catch (e) {
      return { status: "error: " + String((e && e.message) || e), fields: {}, pdfUrl: "" };
    }
  }

  async function appendRow(row) {
    const data = await chrome.storage.local.get([STORAGE_KEY, ACTIVE_CITY_KEY]);
    const rows = data[STORAGE_KEY] || [];
    const consigneeCity = data[ACTIVE_CITY_KEY] || "";
    const withCity = { ...row, consigneeCity };
    // Dedupe on bidNo *plus* city, not bidNo alone - the same bid can
    // legitimately turn up again when scanning a different city (a bid
    // can list more than one consignee), and collapsing those into one
    // row would silently drop a city's worth of results.
    const dedupeKey = (r) => r.bidNo + "||" + (r.consigneeCity || "");
    const idx = rows.findIndex((r) => dedupeKey(r) === dedupeKey(withCity));
    if (idx === -1) rows.push(withCity);
    else rows[idx] = { ...rows[idx], ...withCity }; // refresh if re-scanned
    await chrome.storage.local.set({ [STORAGE_KEY]: rows });
    return rows.length;
  }

  // Same as appendRow(), just writing to the OMS-batch-only accumulator
  // instead of the popup's shared gemBidRows.
  async function appendOmsBatchRow(row) {
    const data = await chrome.storage.local.get([OMS_BATCH_ROWS_KEY, ACTIVE_CITY_KEY]);
    const rows = data[OMS_BATCH_ROWS_KEY] || [];
    const consigneeCity = data[ACTIVE_CITY_KEY] || "";
    const withCity = { ...row, consigneeCity };
    const dedupeKey = (r) => r.bidNo + "||" + (r.consigneeCity || "");
    const idx = rows.findIndex((r) => dedupeKey(r) === dedupeKey(withCity));
    if (idx === -1) rows.push(withCity);
    else rows[idx] = { ...rows[idx], ...withCity };
    await chrome.storage.local.set({ [OMS_BATCH_ROWS_KEY]: rows });
    return rows.length;
  }

  async function setStatus(status) {
    // Merge instead of overwrite: autoScanAllPages() and its per-page
    // progress updates only know about page/scanned counters, not which
    // city/phase of a city-batch is active. A plain overwrite here used to
    // wipe cityIndex/cityLabel/phase the moment scanning started, so the
    // popup's progress line went blank mid-run even though the batch was
    // working fine.
    const data = await chrome.storage.local.get(STATUS_KEY);
    const prev = data[STATUS_KEY] || {};
    await chrome.storage.local.set({ [STATUS_KEY]: { ...prev, ...status } });
  }

  // opts.omsRunId (optional): when set, rows are written to the OMS-only
  // accumulator (OMS_BATCH_ROWS_KEY) instead of the popup's shared
  // gemBidRows - used when this is running as part of an OMS-triggered
  // city batch (see runBatchStepIfActive/finishOmsBatch below) rather than
  // a manual scan.
  async function scanRowsWithPdf(rows, opts) {
    const omsRunId = opts && opts.omsRunId;
    for (const row of rows) {
      const pdfResult = row.bidLink
        ? await fetchAndParsePdf(row.bidLink, PDF_FIELD_LABELS)
        : { status: "no_link", fields: {}, pdfUrl: "" };
      const merged = { ...row, pdfStatus: pdfResult.status, pdfDirectUrl: pdfResult.pdfUrl || "", ...pdfResult.fields };
      const atcLinks = pdfResult.fields[ATC_LABEL + "__links"];
      merged[ATC_LABEL] = atcLinks && atcLinks.length ? atcLinks[0] : "";
      const total = omsRunId ? await appendOmsBatchRow(merged) : await appendRow(merged);
      await setStatus({ scanning: true, scanned: total, lastAction: omsRunId ? "city_batch" : "pdf", lastBidNo: row.bidNo });
    }
  }

  // ---------------------------------------------------------------------
  // Advance-search (consignee location) form automation.
  //
  // This was written without being able to load the live
  // bidplus.gem.gov.in/advance-search page directly (the site's robots.txt
  // blocks automated fetches from outside a real browser), so none of the
  // selectors below are hardcoded IDs - everything is matched by keyword
  // against id/name/aria-label and by visible label text, with several
  // fallbacks tried in order. This is the same "adjust the matcher, not
  // the message handler" situation the README already flags for
  // findNextControl() - if a step below can't find something, open
  // DevTools on the advance-search page, inspect the field in question,
  // and add its actual id/name string to the matching keyword list.
  // ---------------------------------------------------------------------

  function setSelectValue(selectEl, value) {
    const proto = window.HTMLSelectElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(selectEl, value);
    selectEl.dispatchEvent(new Event("input", { bubbles: true }));
    selectEl.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function selectOptionByText(selectEl, text) {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const target = norm(text);
    const opts = Array.from(selectEl.options || []);
    let opt = opts.find((o) => norm(o.textContent) === target);
    if (!opt) opt = opts.find((o) => norm(o.textContent).includes(target));
    if (!opt) return false;
    setSelectValue(selectEl, opt.value);
    return true;
  }

  // Finds a <select> whose id/name/aria-label OR nearby label text
  // matches one of the given keywords (checked in order - put the most
  // specific keyword first, e.g. "consignee state" before bare "state",
  // so a generic "State" field elsewhere on the page isn't picked first).
  function findSelectByKeywords(keywordGroups) {
    const selects = Array.from(document.querySelectorAll("select"));
    for (const keywords of keywordGroups) {
      for (const sel of selects) {
        const attrBlob = [sel.id, sel.name, sel.getAttribute("aria-label"), sel.className]
          .join(" ")
          .toLowerCase();
        if (attrBlob.includes(keywords)) return sel;
      }
    }
    for (const keywords of keywordGroups) {
      for (const sel of selects) {
        let labelText = "";
        if (sel.id) {
          const lbl = document.querySelector(`label[for="${CSS.escape(sel.id)}"]`);
          if (lbl) labelText = lbl.textContent || "";
        }
        if (!labelText) {
          const parentLabel = sel.closest("label");
          if (parentLabel) labelText = parentLabel.textContent || "";
        }
        if (!labelText) {
          // Fall back to whatever text sits just before the select inside
          // its immediate form-group / column wrapper.
          const wrapper = sel.closest("div") || sel.parentElement;
          if (wrapper) labelText = wrapper.textContent || "";
        }
        if (labelText.toLowerCase().includes(keywords)) return sel;
      }
    }
    return null;
  }

  // Finds a <select> whose OPTIONS literally include the given text (e.g.
  // "Gujarat"). This is a much stronger signal than matching the select's
  // id/name/label by keyword: a state dropdown is guaranteed to list real
  // Indian state names as its options no matter what its id happens to be,
  // whereas keyword-matching on id/name/label was tried first and got the
  // wrong <select> in practice (see README's honesty note on this file).
  function findSelectByOptionText(text) {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const target = norm(text);
    const selects = Array.from(document.querySelectorAll("select"));
    for (const sel of selects) {
      const opts = Array.from(sel.options || []);
      if (opts.some((o) => norm(o.textContent) === target)) return sel;
    }
    for (const sel of selects) {
      const opts = Array.from(sel.options || []);
      if (opts.some((o) => norm(o.textContent).includes(target))) return sel;
    }
    return null;
  }

  // Same keyword-matching approach as findSelectByKeywords(), for text/date
  // <input> fields instead of <select> elements - used only by the
  // best-effort Bid Start Date filter below.
  function findDateInputByKeywords(keywordGroups) {
    const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="date"], input:not([type])'));
    for (const keywords of keywordGroups) {
      for (const el of inputs) {
        const attrBlob = [el.id, el.name, el.getAttribute("aria-label"), el.className, el.placeholder]
          .join(" ")
          .toLowerCase();
        if (attrBlob.includes(keywords)) return el;
      }
    }
    for (const keywords of keywordGroups) {
      for (const el of inputs) {
        let labelText = "";
        if (el.id) {
          const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (lbl) labelText = lbl.textContent || "";
        }
        if (!labelText) {
          const wrapper = el.closest("div") || el.parentElement;
          if (wrapper) labelText = wrapper.textContent || "";
        }
        if (labelText.toLowerCase().includes(keywords)) return el;
      }
    }
    return null;
  }

  function setInputValue(inputEl, value) {
    const proto = window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(inputEl, value);
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    inputEl.dispatchEvent(new Event("change", { bubbles: true }));
    inputEl.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  // Best-effort Bid Start Date range filter, applied right before the Search
  // button is clicked in runConsigneeSearch(). Skipped entirely (returns
  // {skipped:true} immediately) unless the popup's date fields actually have
  // a value, so a wrong guess here can never break a run that didn't ask for
  // date filtering.
  //
  // Same honesty note as the consignee state/city matching above: this was
  // written without access to the live advance-search page, so these ids are
  // keyword guesses, not confirmed. If a value doesn't take, open the popup's
  // Diagnose Page (now also lists every text input on the page, not just
  // dropdowns), find the real id/name of GeM's Bid Start Date From/To
  // fields, and add it to the keyword lists below.
  async function applyBidStartDateFilter() {
    const data = await chrome.storage.local.get([BID_START_DATE_FROM_KEY, BID_START_DATE_TO_KEY]);
    const from = (data[BID_START_DATE_FROM_KEY] || "").trim();
    const to = (data[BID_START_DATE_TO_KEY] || "").trim();
    if (!from && !to) return { ok: true, skipped: true };

    if (from) {
      const el = findDateInputByKeywords(["bid start date from", "startdatefrom", "start_date_from", "fromdate", "bid start date"]);
      if (!el) return { ok: false, error: "start_date_from_input_not_found" };
      setInputValue(el, from);
    }
    if (to) {
      const el = findDateInputByKeywords(["bid start date to", "startdateto", "start_date_to", "todate", "bid start date"]);
      if (!el) return { ok: false, error: "start_date_to_input_not_found" };
      setInputValue(el, to);
    }
    return { ok: true, skipped: false };
  }

  function clickTabByHash(hash, textFallback) {
    let el =
      document.querySelector(`a[href="${hash}"]`) ||
      document.querySelector(`[data-target="${hash}"]`) ||
      document.querySelector(`[aria-controls="${hash.replace("#", "")}"]`);
    if (!el && textFallback) {
      const candidates = Array.from(document.querySelectorAll("a, li, button"));
      el = candidates.find((c) => (c.textContent || "").toLowerCase().includes(textFallback));
    }
    if (el) {
      el.click();
      return true;
    }
    return false;
  }

  function findSearchButtonNearby(scopeEl) {
    const scope = scopeEl || document;
    const candidates = Array.from(scope.querySelectorAll("button, input[type=submit], input[type=button], a.btn, a[role=button]"));
    return (
      candidates.find((el) => /^\s*search\s*$/i.test(el.textContent || el.value || "")) ||
      candidates.find((el) => /search/i.test(el.textContent || el.value || "")) ||
      null
    );
  }

  async function waitForResults(timeoutMs, prevFirstBidNo) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const cards = findBidCards();
      // Require the result set to actually differ from what was on screen
      // before this search was submitted - not just "some cards exist".
      // Checking presence alone is what let a stale, not-yet-replaced
      // previous city's results pass as "the new search finished" before
      // GeM's AJAX call had actually swapped the list.
      if (cards.length > 0 && (!prevFirstBidNo || cards[0].bidNo !== prevFirstBidNo)) return true;
      await sleep(400);
    }
    // Timed out without seeing a change. Still accept whatever is on
    // screen if it's non-empty (e.g. this city's first bid genuinely
    // matches the previous city's by coincidence) rather than failing a
    // search that may actually have succeeded.
    return findBidCards().length > 0;
  }

  // Lists every <select> on the page with enough detail (id/name/class/
  // visible options) to identify the real Consignee State/City fields by
  // eye, for the popup's "Diagnose Page" button.
  async function listAllSelectsForDebug() {
    clickTabByHash("#tab2", "consignee location");
    await sleep(800);

    const selectEls = Array.from(document.querySelectorAll("select"));
    const selects = selectEls.map((sel, i) => {
      let labelText = "";
      if (sel.id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(sel.id)}"]`);
        if (lbl) labelText = (lbl.textContent || "").trim();
      }
      if (!labelText) {
        const parentLabel = sel.closest("label");
        if (parentLabel) labelText = (parentLabel.textContent || "").trim();
      }
      const opts = Array.from(sel.options || []).map((o) => (o.textContent || "").trim());
      const visible = !!(sel.offsetWidth || sel.offsetHeight || sel.getClientRects().length);
      return {
        index: i,
        id: sel.id || "",
        name: sel.name || "",
        className: sel.className || "",
        nearbyLabel: labelText,
        visible,
        optionCount: opts.length,
        sampleOptions: opts.slice(0, 8),
      };
    });

    // Also list text/date inputs - needed to find the real ids for GeM's
    // Bid Start Date From/To fields if the keyword guesses in
    // applyBidStartDateFilter() don't match.
    const inputEls = Array.from(document.querySelectorAll('input[type="text"], input[type="date"], input:not([type])'));
    const inputs = inputEls.map((el, i) => {
      let labelText = "";
      if (el.id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl) labelText = (lbl.textContent || "").trim();
      }
      if (!labelText) {
        const wrapper = el.closest("div") || el.parentElement;
        if (wrapper) labelText = (wrapper.textContent || "").trim().slice(0, 60);
      }
      const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      return {
        index: i,
        id: el.id || "",
        name: el.name || "",
        type: el.type || "text",
        placeholder: el.placeholder || "",
        className: el.className || "",
        nearbyLabel: labelText,
        visible,
      };
    });

    return { selects, inputs };
  }

  // Confirmed against the live page's actual DOM (via the popup's
  // "Diagnose Page" button): the real Consignee State/City selects have
  // ids "state_name_con" / "city_name_con". Try that first - it's exact.
  // Then fall back to content-based matching (a select whose OPTIONS
  // literally include "Gujarat") in case GeM changes the id later - a
  // state dropdown is guaranteed to list real state names as options no
  // matter what id it has. Deliberately no bare "state"/"city" keyword
  // fallback: that matched a decoy dropdown on this exact page
  // (id="buyer_state", which also contains the substring "state" and
  // sits earlier in the DOM, with only one empty option), which is what
  // caused every state selection to fail before this fix.
  function findConsigneeStateSelect(state) {
    return document.getElementById("state_name_con") || findSelectByOptionText(state);
  }

  function findConsigneeCitySelect() {
    return document.getElementById("city_name_con") || findSelectByKeywords(["consignee city", "consigneecity"]);
  }

  async function getCityOptionsForState(state) {
    clickTabByHash("#tab2", "consignee location");
    await sleep(500);

    const stateSelect = findConsigneeStateSelect(state);
    if (!stateSelect) return { ok: false, error: "state_select_not_found" };
    if (!selectOptionByText(stateSelect, state)) return { ok: false, error: "state_option_not_found" };

    let citySelect = null;
    const waitStart = Date.now();
    while (Date.now() - waitStart < 8000) {
      citySelect = findConsigneeCitySelect();
      if (citySelect && citySelect.options && citySelect.options.length > 1) break;
      citySelect = null;
      await sleep(300);
    }
    if (!citySelect) return { ok: false, error: "city_select_not_found" };

    const PLACEHOLDER_RE = /^\s*$|^-+$|select|all\b/i;
    const cities = Array.from(citySelect.options)
      .map((o) => (o.textContent || "").replace(/\s+/g, " ").trim())
      .filter((t) => t && !PLACEHOLDER_RE.test(t));

    if (!cities.length) return { ok: false, error: "no_city_options_found" };
    return { ok: true, cities };
  }

  async function runConsigneeSearch(state, city) {
    await chrome.storage.local.set({ [ACTIVE_CITY_KEY]: city || "" });

    clickTabByHash("#tab2", "consignee location");
    await sleep(500);

    const stateSelect = findConsigneeStateSelect(state);
    if (!stateSelect) return { ok: false, error: "state_select_not_found" };
    if (!selectOptionByText(stateSelect, state)) return { ok: false, error: "state_option_not_found" };

    // The city dropdown is typically populated by an AJAX call fired off
    // the state's change event, so give it a few seconds to fill in
    // before giving up on finding it.
    let citySelect = null;
    const waitStart = Date.now();
    while (Date.now() - waitStart < 8000) {
      citySelect = findConsigneeCitySelect();
      if (citySelect && citySelect.options && citySelect.options.length > 1) break;
      citySelect = null;
      await sleep(300);
    }
    if (!citySelect) return { ok: false, error: "city_select_not_found" };
    if (city) {
      if (!selectOptionByText(citySelect, city)) return { ok: false, error: "city_option_not_found" };
    }

    const dateResult = await applyBidStartDateFilter();
    if (!dateResult.ok) return { ok: false, error: dateResult.error };

    const activePane = document.querySelector("#tab2") || document.querySelector(".tab-pane.active") || document;
    const btn = findSearchButtonNearby(activePane) || findSearchButtonNearby(document);
    if (!btn) return { ok: false, error: "search_button_not_found" };
    const prevFirstBidNo = (findBidCards()[0] || {}).bidNo;
    btn.click();

    const gotResults = await waitForResults(12000, prevFirstBidNo);
    return { ok: gotResults, error: gotResults ? undefined : "no_results_detected" };
  }

  async function isBatchCancelled() {
    const data = await chrome.storage.local.get(CITY_BATCH_KEY);
    const batch = data[CITY_BATCH_KEY];
    return !!batch && batch.running === false;
  }

  // Marks the current city batch as not-running - shared by the popup's
  // "Cancel Running City Batch" button and by autoScanAllPages() below when
  // it notices an OMS-triggered run was Stopped from the OMS page mid-scan.
  async function cancelCityBatch() {
    const data = await chrome.storage.local.get(CITY_BATCH_KEY);
    const batch = data[CITY_BATCH_KEY];
    if (batch) {
      batch.running = false;
      await chrome.storage.local.set({ [CITY_BATCH_KEY]: batch });
    }
  }

  async function isOmsRunStillActive(runId) {
    const result = await sendToBackground("GEM_BID_SYNC_STATUS", { runId });
    return !!(result && result.ok && result.run && result.run.status === "scraping");
  }

  async function autoScanAllPages(lastAction) {
    await setStatus({ scanning: true, scanned: 0, page: 1, lastAction });
    let pageNum = 1;
    let guard = 0;

    // Only set for a city_batch step that's driving an OMS-triggered run
    // (see runBatchStepIfActive) - a manual city batch or a plain
    // Auto-Scan click has no OMS run backing it.
    let omsRunId = null;
    if (lastAction === "city_batch") {
      const data = await chrome.storage.local.get(CITY_BATCH_KEY);
      omsRunId = (data[CITY_BATCH_KEY] || {}).omsRunId || null;
    }

    while (guard < 60) {
      guard++;
      if (lastAction === "city_batch") {
        if (await isBatchCancelled()) break;
        if (omsRunId && !(await isOmsRunStillActive(omsRunId))) {
          // The OMS run was Stopped (or discarded) from the OMS page while
          // this city was mid-scan - stop the whole batch, not just this
          // city's page loop, the same as a manual Cancel click.
          await cancelCityBatch();
          break;
        }
      }
      const rows = scanCurrentPage();
      if (rows.length === 0) break;
      // Filtered before the (slow, one-per-bid) PDF fetch below, not after -
      // an excluded row never costs a PDF fetch. Pagination still anchors on
      // the unfiltered `rows` so "did the page actually change" detection
      // isn't thrown off by everything on a page being filtered out.
      const filteredRows = await filterRowsByItemKeywords(rows);
      await scanRowsWithPdf(filteredRows, omsRunId ? { omsRunId } : undefined);
      await setStatus({ scanning: true, page: pageNum, lastAction });

      if (omsRunId) {
        const cbData = await chrome.storage.local.get(CITY_BATCH_KEY);
        const cb = cbData[CITY_BATCH_KEY] || {};
        const cityLabel =
          cb.cities && cb.cities.length > 1
            ? `[${(cb.index || 0) + 1}/${cb.cities.length}] ${cb.cities[cb.index] || ""} — `
            : "";
        const omsRowsData = await chrome.storage.local.get(OMS_BATCH_ROWS_KEY);
        const rowCount = (omsRowsData[OMS_BATCH_ROWS_KEY] || []).length;
        await sendToBackground("GEM_BID_SYNC_PROGRESS", {
          runId: omsRunId,
          percent: Math.min(90, pageNum * 10),
          phase: `${cityLabel}page ${pageNum} — ${rowCount} bids scanned`,
        });
      }

      const firstBidNo = rows[0].bidNo;
      const nextEl = findNextControl();
      if (!nextEl) break;
      nextEl.click();
      const changed = await waitForListChange(firstBidNo, 10000);
      if (!changed) break;
      pageNum++;
    }
    const key = omsRunId ? OMS_BATCH_ROWS_KEY : STORAGE_KEY;
    const data = await chrome.storage.local.get(key);
    await setStatus({ scanning: false, scanned: (data[key] || []).length, page: pageNum, lastAction });
  }

  let batchStepInFlight = false;

  // Advances (or resumes) a RUN_CITY_BATCH job by exactly one step, then -
  // if this execution context is still alive, meaning the site did NOT
  // full-page-navigate us away - keeps going by calling itself again.
  // If the context *does* die partway through (a real page load), this
  // function simply never returns; the freshly injected content script's
  // own call to this same function (see bottom of file) picks the batch
  // back up from whatever phase/index was last persisted to storage.
  async function runBatchStepIfActive() {
    if (batchStepInFlight) return;
    batchStepInFlight = true;
    try {
      const data = await chrome.storage.local.get(CITY_BATCH_KEY);
      const batch = data[CITY_BATCH_KEY];
      if (!batch || !batch.running) return;

      if (batch.index >= batch.cities.length) {
        batch.running = false;
        await chrome.storage.local.set({ [CITY_BATCH_KEY]: batch });
        if (batch.omsRunId) {
          await finishOmsBatch(batch.omsRunId);
        } else {
          const exported = await exportRowsToXlsx("gujarat");
          await setStatus({ scanning: false, lastAction: "city_batch_done", exported });
        }
        return;
      }

      const city = batch.cities[batch.index];
      await chrome.storage.local.set({ [ACTIVE_CITY_KEY]: city || "" });
      await setStatus({
        scanning: true,
        lastAction: "city_batch",
        cityIndex: batch.index,
        cityTotal: batch.cities.length,
        cityLabel: city || `all of ${batch.state}`,
        phase: batch.phase,
      });

      if (batch.phase === "search") {
        // Always re-drive the form for this city - do NOT skip it just
        // because bid cards are currently visible. This used to skip
        // whenever cards were on screen, on the assumption that meant "we
        // just resumed after a page reload the Search click caused, and
        // the results already showing are this city's." In practice GeM's
        // search doesn't reload the page, so the *previous* city's results
        // are still sitting on screen when this step runs for the next
        // city - the skip fired every time and left every city after the
        // first re-scanning the same unchanged results, just relabeled
        // with the new city name. Re-running the search here is safe even
        // in the genuine post-reload-resume case (it just reselects the
        // same state/city and re-submits), so there's no good reason to
        // skip it.
        const searchResult = await runConsigneeSearch(batch.state, city);
        if (!searchResult.ok && batch.omsRunId) {
          // An OMS-triggered run is unattended - nobody's watching the
          // popup to notice a silently wrong/empty result set the way a
          // manual city batch's user might. Fail loudly instead of scanning
          // whatever happens to be on screen and pushing it to the OMS.
          throw new Error("consignee search failed: " + (searchResult.error || "unknown"));
        }
        batch.phase = "scan";
        await chrome.storage.local.set({ [CITY_BATCH_KEY]: batch });
      }

      if (batch.phase === "scan") {
        await autoScanAllPages("city_batch");
        // Re-read rather than trust this function's in-memory `batch`
        // snapshot - a Cancel click (manual) or the OMS run being Stopped
        // (checked inside autoScanAllPages) may have flipped `running` to
        // false while the scan was in progress. Writing the stale snapshot
        // back here used to silently resurrect a cancelled batch and let it
        // continue on to the next city.
        const freshData = await chrome.storage.local.get(CITY_BATCH_KEY);
        const freshBatch = freshData[CITY_BATCH_KEY];
        if (!freshBatch || !freshBatch.running) {
          if (batch.omsRunId) await chrome.storage.local.remove(CLAIMED_RUN_KEY);
          await setStatus({ scanning: false, lastAction: "city_batch_cancelled" });
          return;
        }
        freshBatch.index += 1;
        freshBatch.phase = "search";
        await chrome.storage.local.set({ [CITY_BATCH_KEY]: freshBatch });
      }
    } catch (e) {
      // Without this, an exception here (e.g. a fetch/PDF-parsing error, or
      // the DOM not matching what a selector expected) used to escape
      // silently: the popup would sit on "Scanning..." forever with no
      // error and no way to know why. Now the batch stops cleanly and the
      // real error is visible in both the popup and this tab's console.
      const msg = String((e && (e.stack || e.message)) || e);
      console.error("[GeM Bid Exporter] city batch step failed:", e);
      try {
        const data = await chrome.storage.local.get(CITY_BATCH_KEY);
        const batch = data[CITY_BATCH_KEY];
        if (batch) {
          batch.running = false;
          await chrome.storage.local.set({ [CITY_BATCH_KEY]: batch });
          if (batch.omsRunId) await chrome.storage.local.remove(CLAIMED_RUN_KEY);
        }
      } catch (_) {
        /* storage itself may be unavailable during a navigation - ignore */
      }
      await setStatus({ scanning: false, lastAction: "city_batch_error", errorMessage: msg });
      return;
    } finally {
      batchStepInFlight = false;
    }
    // Still alive (no reload happened) - keep the batch moving.
    runBatchStepIfActive();
  }

  // Sends everything this OMS-triggered batch collected (across every city)
  // to the OMS in one sync/apply call, the same end-of-run step a plain
  // Start Sync always used to do - just fed from a full multi-city sweep
  // instead of "whatever the tab happened to already be showing".
  async function finishOmsBatch(runId) {
    const data = await chrome.storage.local.get(OMS_BATCH_ROWS_KEY);
    const rows = data[OMS_BATCH_ROWS_KEY] || [];
    await setStatus({
      scanning: true,
      lastAction: "city_batch",
      phase: "apply",
      cityLabel: `sending ${rows.length} bid(s) to OMS…`,
    });
    const userData = await chrome.storage.local.get(OMS_USER_KEY);
    const applyResult = await sendToBackground("GEM_BID_SYNC_APPLY", {
      runId,
      rows: rows.map(mapBidRowToOmsSchema),
      userName: userData[OMS_USER_KEY] || "",
    });
    await chrome.storage.local.remove([OMS_BATCH_ROWS_KEY, CLAIMED_RUN_KEY]);
    if (applyResult && applyResult.ok) {
      await setStatus({ scanning: false, lastAction: "city_batch_done", omsApplied: true, omsRowCount: rows.length });
    } else {
      await setStatus({
        scanning: false,
        lastAction: "city_batch_error",
        errorMessage: (applyResult && applyResult.error) || "apply failed",
      });
    }
  }

  // ---------------------------------------------------------------------
  // OMS-triggered sync bridge. background.js polls the OMS for a pending
  // "scraping" run (its filterState/filterCities/dateFrom/dateTo), opens or
  // navigates a bidplus.gem.gov.in tab to Advance Search, and stashes a
  // CITY_BATCH_KEY job (with omsRunId set) in storage before doing so - this
  // script's own unconditional runBatchStepIfActive() call at the bottom of
  // the file then picks it up exactly like a popup-started manual city
  // batch, just reporting progress to the OMS and finishing with a
  // sync/apply call (finishOmsBatch above) instead of an Excel download.
  // ---------------------------------------------------------------------

  const OMS_USER_KEY = "gemOmsUserName";

  // Mirrors popup.js's mapRowToOmsSchema exactly - duplicated here (not
  // shared) because these are plain injected scripts with no bundler, same
  // reason STORAGE_KEY/PDF_FIELD_LABELS/EXPORT_HEADERS are already
  // duplicated between popup.js and content.js.
  function mapBidRowToOmsSchema(r) {
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

  function sendToBackground(type, payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, ...payload }, (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve({ ok: false, error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || "no response" });
          return;
        }
        resolve(response);
      });
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "PING") {
      sendResponse({ ok: true });
      return;
    }

    if (msg.action === "SCAN_PAGE_FAST") {
      (async () => {
        const rows = await filterRowsByItemKeywords(scanCurrentPage());
        for (const row of rows) await appendRow(row);
        const data = await chrome.storage.local.get(STORAGE_KEY);
        await setStatus({ scanning: false, scanned: (data[STORAGE_KEY] || []).length, lastAction: "fast" });
      })();
      sendResponse({ ok: true, started: true });
      return;
    }

    if (msg.action === "SCAN_PAGE_WITH_PDF") {
      (async () => {
        await setStatus({ scanning: true, scanned: 0, lastAction: "pdf" });
        const rows = await filterRowsByItemKeywords(scanCurrentPage());
        await scanRowsWithPdf(rows);
        const data = await chrome.storage.local.get(STORAGE_KEY);
        await setStatus({ scanning: false, scanned: (data[STORAGE_KEY] || []).length, lastAction: "pdf" });
      })();
      sendResponse({ ok: true, started: true });
      return;
    }

    if (msg.action === "DEBUG_LIST_SELECTS") {
      (async () => {
        try {
          const { selects, inputs } = await listAllSelectsForDebug();
          sendResponse({ ok: true, selects, inputs });
        } catch (e) {
          try {
            sendResponse({ ok: false, error: "exception: " + String((e && e.message) || e) });
          } catch (_) {
            /* ignore */
          }
        }
      })();
      return true;
    }

    if (msg.action === "GET_CITY_LIST") {
      (async () => {
        try {
          const result = await getCityOptionsForState(msg.state || "Gujarat");
          sendResponse(result);
        } catch (e) {
          try {
            sendResponse({ ok: false, error: "exception: " + String((e && e.message) || e) });
          } catch (_) {
            /* popup already gave up listening - fine, ignore */
          }
        }
      })();
      return true; // keep the message channel open for the async sendResponse above
    }

    if (msg.action === "RUN_CONSIGNEE_SEARCH") {
      (async () => {
        try {
          const result = await runConsigneeSearch(msg.state || "Gujarat", msg.city || "");
          sendResponse(result);
        } catch (e) {
          try {
            sendResponse({ ok: false, error: "exception: " + String((e && e.message) || e) });
          } catch (_) {
            /* popup already gave up listening (page navigated away) - fine, ignore */
          }
        }
      })();
      return true; // keep the message channel open for the async sendResponse above
    }

    if (msg.action === "AUTO_SCAN_ALL") {
      (async () => {
        await autoScanAllPages("auto");
      })();
      sendResponse({ ok: true, started: true });
      return;
    }

    if (msg.action === "RUN_CITY_BATCH") {
      (async () => {
        await chrome.storage.local.set({
          [CITY_BATCH_KEY]: {
            state: msg.state || "Gujarat",
            cities: Array.isArray(msg.cities) && msg.cities.length ? msg.cities : [""],
            index: 0,
            phase: "search",
            running: true,
          },
        });
        runBatchStepIfActive(); // deliberately not awaited - this is the long-running job
      })();
      sendResponse({ ok: true, started: true });
      return;
    }

    if (msg.action === "CANCEL_CITY_BATCH") {
      (async () => {
        await cancelCityBatch();
        await setStatus({ scanning: false, lastAction: "city_batch_cancelled" });
      })();
      sendResponse({ ok: true });
      return;
    }
  });

  // If a city batch was mid-flight when this script last ran (popup
  // closed, or the search-form submission navigated the page away and
  // this script is the freshly re-injected instance on the new page),
  // pick the batch back up automatically. This is what makes RUN_CITY_BATCH
  // survive both the popup closing and a full page reload - the "resume
  // point" lives in chrome.storage.local, not in any in-memory JS state a
  // reload would wipe out. It's also how an OMS-triggered batch actually
  // starts: background.js writes a CITY_BATCH_KEY job (with omsRunId set)
  // and navigates a tab to this page *before* this script even loads, so
  // this same call picks it up on the very first run, no separate
  // OMS-polling loop needed in this script at all.
  runBatchStepIfActive();
})();
