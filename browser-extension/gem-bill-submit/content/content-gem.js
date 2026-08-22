// content/content-gem.js
// Runs on fulfilment.gem.gov.in. Drives the real multi-step "raise invoice"
// flow, mapped out live on 20-Aug-2026 against a real order:
//
//   Orders list (search contract) -> PROCESS ORDER -> Order Details
//   -> GENERATE INVOICE (per consignee) -> Order Summary wizard:
//        1. Upload Documents/Bill  (PDF file input)
//        2. Invoice Details        (invoice number, dates, dispatch mode, place of supply)
//        3. Product Details        (per line: qty, tax rate, HSN, GST UQ name)
//   -> Invoice Preview (checkbox + CREATE) -> Success modal
//   -> "Proceed to e-verify" -> OTP Verification radio -> OTP box -> VERIFY
//
// It's an Angular SPA using hash routing (#WORKSPACE_ID=...) - navigating
// between these steps does NOT reload the page, so this script's state
// normally survives the whole flow. As a safety net (in case a step DOES
// trigger a real reload), progress is also persisted to
// chrome.storage.local so a fresh script load can resume from where the
// hash/URL says it left off, instead of restarting from search.
//
// Navigation/upload/preview/e-verify selectors were captured live via
// DevTools inspection. Invoice Details + Product Details field IDs
// (INVOICE_CREATION_FORM-*, INVOICE_ITEMS_FORM-*) come from a standalone
// "GeM Bill Auto Fill" extension that was hand-built and tested earlier
// against this exact form - Tax Rate/HSN Code (Tax Invoice only) have no
// confirmed ID yet and still fall back to <label> text matching.

(function () {
  const MAX_WAIT_MS = 20000;

  init();

  async function init() {
    const { data } = await chrome.runtime.sendMessage({ type: "GET_PENDING_SUBMISSION" });
    if (!data) return; // koi pending submission nahi hai, kuch mat karo

    if (Date.now() - data.startedAt > 15 * 60 * 1000) {
      chrome.storage.local.remove("pendingBillSubmission");
      return;
    }

    console.log("[GeM Bill Auto-Submit] Pending submission mila:", data);

    // GeM shows a marketing popup ("Unlock GeM Sahay!") at unpredictable
    // points that blocks interaction until dismissed - swept away in the
    // background for the whole run rather than checked at each step.
    const popupSweeper = setInterval(dismissKnownPopups, 1000);

    runAutomationFlow(data)
      .catch((err) => {
        console.error("[GeM Bill Auto-Submit] Automation fail hua:", err);
        alert(`GeM Bill Auto-Submit me error aaya: ${err.message}\n\nKripya manually process complete karo.`);
      })
      .finally(() => clearInterval(popupSweeper));
  }

  async function setStep(data, step) {
    data.step = step;
    await chrome.storage.local.set({ pendingBillSubmission: data });
  }

  async function runAutomationFlow(data) {
    const step = data.step || "SEARCH";

    if (step === "SEARCH") {
      await stepSearchAndOpenOrder(data);
      // documentOnly retries (bill already submitted+verified on GeM, sirf
      // OMS-side me GeM ka PDF missing hai) seedha document fetch pe jaate
      // hain - GENERATE INVOICE dobara chalana already-invoiced order pe
      // error ya duplicate invoice bana sakta hai.
      await setStep(data, data.documentOnly ? "GEM_DOCUMENT" : "GENERATE_INVOICE");
    }
    if (data.step === "GENERATE_INVOICE") {
      await stepGenerateInvoice(data);
      await setStep(data, "UPLOAD");
    }
    if (data.step === "UPLOAD") {
      await stepUploadDocument(data);
      await setStep(data, "INVOICE_DETAILS");
    }
    if (data.step === "INVOICE_DETAILS") {
      await stepInvoiceDetails(data);
      await setStep(data, "PRODUCT_DETAILS");
    }
    if (data.step === "PRODUCT_DETAILS") {
      await stepProductDetails(data);
      await setStep(data, "PREVIEW_CREATE");
    }
    if (data.step === "PREVIEW_CREATE") {
      await stepPreviewAndCreate(data);
      await setStep(data, "E_VERIFY");
    }
    if (data.step === "E_VERIFY") {
      await stepEVerifyWithOtp(data);
      await setStep(data, "GEM_DOCUMENT");
    }
    if (data.step === "GEM_DOCUMENT") {
      if (data.documentOnly) {
        // This run's whole point IS the document fetch - let a failure
        // propagate so the outer catch's alert() actually tells the user,
        // instead of silently swallowing it like the full-flow case below.
        await stepFetchAndUploadGemDocument(data);
      } else {
        // Non-fatal: the bill is already fully submitted on GeM at this
        // point, so a failure here shouldn't alarm-and-stop like the earlier
        // steps do - it just means OMS won't have a copy of GeM's own PDF.
        try {
          await stepFetchAndUploadGemDocument(data);
        } catch (err) {
          console.error("[GeM Bill Auto-Submit] GeM document fetch/upload failed (bill itself is still submitted fine):", err);
        }
      }
      await setStep(data, "DONE");
    }

    console.log("[GeM Bill Auto-Submit] Bill flow complete:", data.billNo);
    chrome.storage.local.remove("pendingBillSubmission");
  }

  // ---------------------------------------------------------------------
  // STEP 1 — Orders list: search contract, open it, click PROCESS ORDER
  // ---------------------------------------------------------------------
  async function stepSearchAndOpenOrder(data) {
    // Land on the Orders workspace if we're not already there.
    if (!location.hash.includes("WORKSPACE_ID=ORDERS_WS")) {
      location.hash = "WORKSPACE_ID=ORDERS_WS";
      await sleep(1500);
    }

    const searchInput = await waitForElement("input.searchinputclass");
    setNativeValue(searchInput, data.contractNo);
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));

    const searchBtn = await waitForElement("#searchBidRA");
    searchBtn.click();

    const processBtn = await waitForElement(
      `.process-order-btn[data-order-no="${cssEscape(data.contractNo)}"]`,
      MAX_WAIT_MS
    );
    processBtn.click();

    // Confirmed live: PROCESS ORDER lands on #WORKSPACE_ID=ORDER_SUMMARY
    // (the "Order Details" page - the breadcrumb says "Details", the URL
    // hash does not, hence checking the hash value directly here).
    await waitForUrlContains("WORKSPACE_ID=ORDER_SUMMARY", MAX_WAIT_MS);
  }

  // ---------------------------------------------------------------------
  // STEP 2 — Order Details: click GENERATE INVOICE for the target consignee
  // ---------------------------------------------------------------------
  async function stepGenerateInvoice(data) {
    // No stable class was captured for this button - matched by its visible
    // text instead. Assumes a single consignee (the common case); if an
    // order has multiple consignees this picks the first one.
    const generateBtn = await waitForElementByText(
      ["button", "a"],
      /generate invoice/i,
      MAX_WAIT_MS
    );
    generateBtn.click();

    // Confirmed live: GENERATE INVOICE lands on #WORKSPACE_ID=GEM_ORDER_SUMMARY
    // (note the "GEM_" prefix - checking for that exact string, not the
    // shorter "ORDER_SUMMARY", since the PREVIOUS page's hash already
    // contains "ORDER_SUMMARY" and would resolve this wait instantly/wrongly).
    await waitForUrlContains("WORKSPACE_ID=GEM_ORDER_SUMMARY", MAX_WAIT_MS);
  }

  // ---------------------------------------------------------------------
  // STEP 3 — Upload Documents/Bill: attach the PDF, click CONTINUE
  // ---------------------------------------------------------------------
  async function stepUploadDocument(data) {
    const uploadBtn = await waitForElement('button[data-item-id="ct-addFile"]');
    uploadBtn.click();

    // The click above triggers a native OS file-picker; instead of touching
    // that, the background script sets the file directly on the hidden
    // <input type="file"> via chrome.debugger (DOM.setFileInputFiles).
    // GeM rejects uploaded filenames with any character other than
    // letters/digits/underscore/hyphen, so the invoice number is sanitized
    // into the filename here.
    const safeFileName = `${String(data.billNo).replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`;
    const attachResult = await chrome.runtime.sendMessage({
      type: "ATTACH_FILE_TO_INPUT",
      selector: 'input[type="file"][name="f0"]',
      fileUrl: data.billPdfUrl,
      fileName: safeFileName,
    });
    if (!attachResult?.success) {
      throw new Error("File attach fail hua: " + (attachResult?.error || "unknown error"));
    }

    await sleep(1500); // let GeM's JS process the file-change event

    // Attaching the file only stages it - GeM shows a separate "UPLOAD"
    // button next to the filename that has to be clicked to actually submit
    // it, and CONTINUE stays disabled until that completes. Matched on exact
    // text "UPLOAD" (not e.g. the e-Way Bill's "Upload File" link).
    const confirmUploadBtn = await waitForElementByText(["button"], /^upload$/i, MAX_WAIT_MS);
    confirmUploadBtn.click();
    await sleep(1500);

    const continueBtn = await waitForElementByText(["button"], /^continue$/i, MAX_WAIT_MS);
    continueBtn.click();
    await sleep(1000);
  }

  // ---------------------------------------------------------------------
  // STEP 4 — Invoice Details
  // ---------------------------------------------------------------------
  // Field IDs below (INVOICE_CREATION_FORM-* / INVOICE_ITEMS_FORM-*) are
  // confirmed real GeM IDs, taken from an earlier standalone "GeM Bill Auto
  // Fill" extension that was hand-tested against this exact form.
  async function stepInvoiceDetails(data) {
    const invoiceNoInput = await waitForElement("#INVOICE_CREATION_FORM-SELL_INVOICE_NO");
    setNativeValue(invoiceNoInput, data.billNo);
    fireEvents(invoiceNoInput);

    // Invoice date + dispatch date both default to the GeM order's own
    // contract date - read straight off the "Contract Date" heading on the
    // page itself (ground truth) rather than trusting whatever the OMS
    // passed through, falling back to that only if the page text changes.
    const contractDate = getContractDateFromPage() || data.contractDate;
    if (contractDate) {
      setTextValueById("INVOICE_CREATION_FORM-INVOICE_DATE", contractDate);
      setTextValueById("INVOICE_CREATION_FORM-DISPATCH_DATE", contractDate);
    }

    // "Manual" is the fixed dispatch mode always used.
    await setSelectValueByIdWithRetry("INVOICE_CREATION_FORM-DISPATCH_MODE", "Manual");

    // Billing Address has one real option (confirmed live) - whichever one
    // shows up (GeM's placeholder option uses value="-1", excluded here).
    await selectFirstRealOptionByIdWithRetry("INVOICE_CREATION_FORM-BILL_ADDR");

    // Place of Supply is always fixed to "Buyer Location" (confirmed live,
    // not "Consignee Location", the only other choice) and must be selected
    // BEFORE "Place of Supply (State/UT Code)" - the state-code dropdown
    // depends on it. Both populate asynchronously, hence the retries.
    await setSelectValueByIdWithRetry("INVOICE_CREATION_FORM-PLACE_OF_SUPPLY", "Buyer Location");
    await sleep(500);

    // Confirmed live: this is always "Gujarat / 24" regardless of the
    // buyer's actual state - not a buyer-state lookup (Place of Supply is
    // set to "Buyer Location" above, but its State/UT Code always resolves
    // to the seller firm's own state here). Hardcoded for now; if a firm
    // outside Gujarat ever uses this extension, this needs to become that
    // firm's own state instead.
    await selectDropdownByIdSubstringWithRetry("INVOICE_CREATION_FORM-PLACE_OF_SUPPLY_STATE_UT", "Gujarat");

    await sleep(300);
    const continueBtn = await waitForElementByText(["button"], /^continue$/i, MAX_WAIT_MS);
    continueBtn.click();
    await sleep(1000);
  }

  // ---------------------------------------------------------------------
  // STEP 5 — Product Details
  // ---------------------------------------------------------------------
  // NOTE: confirmed IDs below are for a single Product Details row. Bills
  // with more than one line item haven't been verified against real
  // multi-row IDs yet - this fills the first row only in that case.
  async function stepProductDetails(data) {
    const items = Array.isArray(data.items) && data.items.length ? data.items : [data];
    const firstItem = items[0];

    await setSelectValueByIdWithRetry("INVOICE_ITEMS_FORM-SVC_TOGGLE", "No");

    // Supplied Qty is always read straight off the page's own "Pending
    // items to ship" figure (ground truth) - always the FULL pending
    // quantity, never partial, even if goods shipped in batches.
    const pendingQty = getPendingQtyFromPage();
    setTextValueById("INVOICE_ITEMS_FORM-SuppliedQty", pendingQty || String(firstItem?.qty ?? ""));

    await setSelectValueByIdWithRetry("INVOICE_ITEMS_FORM-GST_UQ_NAME", "NOS");

    if (data.billType === "TAX_INVOICE") {
      if (firstItem?.gstPercent !== undefined) {
        selectDropdownByLabel(/tax rate/i, `${firstItem.gstPercent}`, 0);
      }
      if (firstItem?.hsnSac) {
        fillInputByLabel(/hsn code/i, firstItem.hsnSac, 0);
      }
    }

    await sleep(300);
    const previewBtn = await waitForElementByText(["button"], /^preview$/i, MAX_WAIT_MS);
    previewBtn.click();
    await sleep(1000);
  }

  // ---------------------------------------------------------------------
  // STEP 6 — Invoice Preview modal: tick declaration, click CREATE
  // ---------------------------------------------------------------------
  async function stepPreviewAndCreate(data) {
    const checkbox = await waitForElement("#prevCheckbox");
    if (!checkbox.checked) checkbox.click();

    const createBtn = await waitForElement('a[data-item-id="PROCESS_BTN"]');
    createBtn.click();

    // Success modal: "Invoice data has been saved... Proceed to e-verify"
    const proceedBtn = await waitForElement('a[data-item-id="dialogBtnOk"]', MAX_WAIT_MS);
    proceedBtn.click();
  }

  // ---------------------------------------------------------------------
  // STEP 7 — e-Verify: pick OTP Verification, fetch OTP from Gmail, submit
  // ---------------------------------------------------------------------
  async function stepEVerifyWithOtp(data) {
    const otpRadio = await waitForElement("#eOtp", MAX_WAIT_MS);
    if (!otpRadio.checked) otpRadio.click();

    const otpBox = await waitForElement("#otp_box", MAX_WAIT_MS);

    const otpResponse = await chrome.runtime.sendMessage({
      type: "FETCH_OTP_FROM_GMAIL",
      firmCode: data.firmCode,
    });
    if (!otpResponse?.success) {
      throw new Error("OTP fetch fail: " + (otpResponse?.error || "unknown error"));
    }

    setNativeValue(otpBox, otpResponse.otp);
    otpBox.dispatchEvent(new Event("input", { bubbles: true }));

    const verifyBtn = await waitForElement("#otp_reference");
    verifyBtn.click();

    await sleep(3000); // let the modal close and the page settle
  }

  // ---------------------------------------------------------------------
  // STEP 8 — Fetch GeM's own e-signed invoice PDF and upload it to OMS
  // ---------------------------------------------------------------------
  // Non-fatal by design (caller doesn't throw on failure): the bill is
  // already fully submitted on GeM by this point, so a failure here just
  // means the copy in OMS is missing, not that anything needs redoing.
  async function stepFetchAndUploadGemDocument(data) {
    if (!data.billId || !data.omsOrigin) {
      console.warn("[GeM Bill Auto-Submit] billId/omsOrigin missing - skipping GeM document upload.");
      return;
    }

    const downloadBtn = await waitForElementMatching(
      () => findInvoiceDownloadButtonForBillNo(data.billNo),
      MAX_WAIT_MS
    );
    const onclickAttr = downloadBtn.getAttribute("onclick") || "";
    const match = onclickAttr.match(/downloadAnchorContent\('([^']+)'\)/);
    if (!match) {
      throw new Error('Download button ke onclick me URL nahi mila (expected downloadAnchorContent(\'...\')).');
    }
    const fullUrl = new URL(match[1], location.origin).href;

    const result = await chrome.runtime.sendMessage({
      type: "FETCH_AND_UPLOAD_GEM_DOCUMENT",
      gemDocumentUrl: fullUrl,
      billId: data.billId,
      omsOrigin: data.omsOrigin,
    });
    if (!result?.success) {
      throw new Error(result?.error || "Unknown error uploading GeM document.");
    }
    console.log("[GeM Bill Auto-Submit] GeM's official invoice document uploaded to OMS.");
  }

  // Finds the "Download Invoice" button in whichever table row contains
  // this bill's invoice number - there can be multiple prior invoices'
  // download buttons on the same Order Details page, so matching blindly
  // on the first .invoice-down button risks grabbing an older one.
  function findInvoiceDownloadButtonForBillNo(billNo) {
    for (const row of document.querySelectorAll("tr")) {
      if (row.textContent.includes(billNo)) {
        const btn = row.querySelector(".invoice-down");
        if (btn && isVisible(btn)) return btn;
      }
    }
    return null;
  }

  // ---- Helpers ----

  // Closes GeM's "Unlock GeM Sahay!" marketing popup (and similar modals)
  // if one is currently on screen, by clicking its visible close/OK control.
  function dismissKnownPopups() {
    const heading = Array.from(document.querySelectorAll("h1, h2, h3, .modal-title, [class*='title']")).find(
      (el) => /unlock gem sahay/i.test(el.textContent) && isVisible(el)
    );
    if (!heading) return;

    const modal = heading.closest(".modal, [class*='modal']") || document;
    const closeBtn =
      modal.querySelector(".close, [class*='close']") ||
      Array.from(modal.querySelectorAll("button")).find((b) => /^ok$/i.test(b.textContent.trim()));
    if (closeBtn && isVisible(closeBtn)) {
      console.log("[GeM Bill Auto-Submit] Dismissing GeM Sahay popup.");
      closeBtn.click();
    }
  }

  function setNativeValue(element, value) {
    const valueSetter = Object.getOwnPropertyDescriptor(element, "value")?.set;
    const prototype = Object.getPrototypeOf(element);
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

    if (valueSetter && valueSetter !== prototypeValueSetter) {
      prototypeValueSetter.call(element, value);
    } else if (prototypeValueSetter) {
      prototypeValueSetter.call(element, value);
    } else {
      element.value = value;
    }
  }

  // GeM's Angular/jQuery-based form validation didn't register a value set
  // via "input" alone - "change" and "blur" are needed too.
  function fireEvents(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  // ---- ID-based field helpers (confirmed real GeM field IDs) ----

  function setTextValueById(id, value) {
    const el = document.getElementById(id);
    if (!el) return false;
    setNativeValue(el, value);
    fireEvents(el);
    return true;
  }

  // Sets a <select>'s value by exact option value, falling back to exact
  // visible text (GeM's option value is sometimes a short code, e.g. "NOS",
  // while the visible label is a longer word, e.g. "NUMBERS").
  function setSelectValueById(id, value) {
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

  // Substring match on visible option text (e.g. matching "Gujarat" within
  // an option whose full text is "Gujarat / 24").
  function selectDropdownByIdSubstring(id, text) {
    const el = document.getElementById(id);
    if (!el) return false;
    const option = Array.from(el.options).find((o) =>
      o.textContent.trim().toLowerCase().includes(String(text).trim().toLowerCase())
    );
    if (!option) return false;

    const wasDisabled = el.disabled;
    if (wasDisabled) el.removeAttribute("disabled");
    el.value = option.value;
    fireEvents(el);
    if (wasDisabled) el.setAttribute("disabled", "disabled");
    return true;
  }

  // For dropdowns with no known per-order value (e.g. Billing Address) -
  // picks the first real option, excluding GeM's placeholder (value="-1").
  function selectFirstRealOptionById(id) {
    const el = document.getElementById(id);
    if (!el) return false;
    const realOption = Array.from(el.options).find((o) => o.value && o.value !== "-1");
    if (!realOption) return false;

    console.log(`[GeM Bill Auto-Submit] Auto-picked "${realOption.textContent.trim()}" for #${id}.`);
    const wasDisabled = el.disabled;
    if (wasDisabled) el.removeAttribute("disabled");
    el.value = realOption.value;
    fireEvents(el);
    if (wasDisabled) el.setAttribute("disabled", "disabled");
    return true;
  }

  // Some dropdowns (Billing Address, Place of Supply) populate their
  // <option> list asynchronously after the page renders, so a single
  // immediate attempt can find the <select> empty. These retry every 500ms
  // for up to ~6s before giving up (with a console warning either way).
  async function setSelectValueByIdWithRetry(id, value, timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (setSelectValueById(id, value)) return true;
      await sleep(500);
    }
    console.warn(`[GeM Bill Auto-Submit] Could not select "${value}" for #${id} after ${timeoutMs}ms.`);
    return false;
  }

  async function selectDropdownByIdSubstringWithRetry(id, text, timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (selectDropdownByIdSubstring(id, text)) return true;
      await sleep(500);
    }
    console.warn(`[GeM Bill Auto-Submit] Option "${text}" never appeared for #${id} after ${timeoutMs}ms.`);
    return false;
  }

  async function selectFirstRealOptionByIdWithRetry(id, timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (selectFirstRealOptionById(id)) return true;
      await sleep(500);
    }
    console.warn(`[GeM Bill Auto-Submit] No real option ever appeared for #${id} after ${timeoutMs}ms.`);
    return false;
  }

  // Reads "Contract Date: DD/MM/YYYY" straight off the Order Details panel heading.
  function getContractDateFromPage() {
    const headings = document.querySelectorAll(".hea-title h3");
    for (const h of headings) {
      if (h.textContent.includes("Contract Date")) {
        const match = h.textContent.match(/(\d{2}\/\d{2}\/\d{4})/);
        if (match) return match[1];
      }
    }
    return null;
  }

  // Reads "Pending items to ship : N" straight off the Product Details page.
  function getPendingQtyFromPage() {
    const match = document.body.textContent.match(/Pending items to ship\s*:\s*(\d+)/i);
    return match ? match[1] : null;
  }

  function waitForElement(selector, timeoutMs = MAX_WAIT_MS) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(selector);
      if (existing && isVisible(existing)) return resolve(existing);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el && isVisible(el)) {
          observer.disconnect();
          clearTimeout(timeoutId);
          resolve(el);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true, attributes: true });

      const timeoutId = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Element "${selector}" ${timeoutMs}ms me nahi mila.`));
      }, timeoutMs);
    });
  }

  // Generic wait for an arbitrary matcher function (returns the element or
  // null) instead of a CSS selector - for lookups too specific for a plain
  // querySelector, like "the download button in the row containing this
  // invoice number".
  function waitForElementMatching(matcherFn, timeoutMs = MAX_WAIT_MS) {
    return new Promise((resolve, reject) => {
      const existing = matcherFn();
      if (existing) return resolve(existing);

      const observer = new MutationObserver(() => {
        const el = matcherFn();
        if (el) {
          observer.disconnect();
          clearTimeout(timeoutId);
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });

      const timeoutId = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`No element matched within ${timeoutMs}ms.`));
      }, timeoutMs);
    });
  }

  // Finds a visible element among `tags` whose own text matches `textRegex`
  // (not its descendants' combined text, to avoid matching a huge wrapper).
  function waitForElementByText(tags, textRegex, timeoutMs = MAX_WAIT_MS) {
    const matches = () => {
      for (const tag of tags) {
        for (const el of document.querySelectorAll(tag)) {
          const ownText = Array.from(el.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent.trim())
            .join(" ")
            .trim() || el.textContent.trim();
          if (textRegex.test(ownText) && isVisible(el)) return el;
        }
      }
      return null;
    };

    return new Promise((resolve, reject) => {
      const existing = matches();
      if (existing) return resolve(existing);

      const observer = new MutationObserver(() => {
        const el = matches();
        if (el) {
          observer.disconnect();
          clearTimeout(timeoutId);
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });

      const timeoutId = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`No element matching ${textRegex} found within ${timeoutMs}ms.`));
      }, timeoutMs);
    });
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && el.offsetParent !== null;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function waitForUrlContains(fragment, timeoutMs = MAX_WAIT_MS) {
    return new Promise((resolve, reject) => {
      if (location.hash.includes(fragment) || location.href.includes(fragment)) return resolve();
      const interval = setInterval(() => {
        if (location.hash.includes(fragment) || location.href.includes(fragment)) {
          clearInterval(interval);
          clearTimeout(timeoutId);
          resolve();
        }
      }, 300);
      const timeoutId = setTimeout(() => {
        clearInterval(interval);
        reject(new Error(`URL never contained "${fragment}" within ${timeoutMs}ms.`));
      }, timeoutMs);
    });
  }

  function cssEscape(value) {
    return window.CSS && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
  }

  // ---- Label-based field lookups (for fields without a captured stable selector) ----

  // Finds the Nth (0-indexed) visible <label> whose text matches labelRegex,
  // then returns its associated input/select - either via a `for` attribute
  // or the nearest input/select within the same form-group container
  // (GeM's markup consistently places label + control together, e.g.
  // <label>Seller GST Tax Invoice Number*</label> immediately followed by
  // the input in the same .form-group wrapper).
  function findFieldByLabel(labelRegex, occurrence = 0) {
    const labels = Array.from(document.querySelectorAll("label")).filter(
      (l) => labelRegex.test(l.textContent) && isVisible(l)
    );
    const label = labels[occurrence];
    if (!label) return null;

    if (label.htmlFor) {
      const byFor = document.getElementById(label.htmlFor);
      if (byFor) return byFor;
    }

    const container = label.closest(".form-group") || label.parentElement;
    return container?.querySelector("input, select") || null;
  }

  function fillInputByLabel(labelRegex, value, occurrence = 0) {
    const input = findFieldByLabel(labelRegex, occurrence);
    if (!input) {
      console.warn(`[GeM Bill Auto-Submit] Field for label ${labelRegex} (occurrence ${occurrence}) not found.`);
      return;
    }
    setNativeValue(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Tax Rate / HSN Code (Tax Invoice only) have no confirmed field ID yet,
  // so these still fall back to label-text matching.
  function selectDropdownByLabel(labelRegex, optionText, occurrence = 0) {
    const select = findFieldByLabel(labelRegex, occurrence);
    if (!select || select.tagName !== "SELECT") return false;
    const option = Array.from(select.options).find((o) =>
      o.textContent.trim().toLowerCase().includes(String(optionText).trim().toLowerCase())
    );
    if (!option) return false;
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
})();
