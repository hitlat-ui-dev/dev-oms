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
// against this exact form. Supply Type, Tax Rate, HSN Code and the
// Product Details Preview button (Tax Invoice / Regular-scheme firms only -
// the Composition/Without-GST flow never shows these) were confirmed live
// 25-Aug-2026 via DevTools: #INVOICE_CREATION_FORM-SUPPLY_TYPE,
// #INVOICE_ITEMS_FORM-TAX_RATE, #INVOICE_ITEMS_FORM-PRODUCT_HSN_CODE,
// #INVOICE_CREATION_FORM-PROCRESS_BTN (sic - that's GeM's own actual id,
// misspelled "PROCRESS" not "PROCESS", confirmed live 25-Aug-2026 via
// DevTools; do not "fix" this typo, it'll just stop matching).

(function () {
  const MAX_WAIT_MS = 20000;

  init();
  checkPendingLogin();
  checkPendingCatalogueUpdate();

  // GeM Login Setup's "Login" button - independent of the bill-submission
  // flow above (that only ever runs on fulfilment.gem.gov.in). GeM's real
  // login is two pages, both confirmed live 24-Aug-2026 on sso.gem.gov.in:
  //   1. User ID + Captcha ("Password shall be entered on next screen..."
  //      is GeM's own on-page text) - #loginid / #captcha_math / a
  //      button.btn1.btn-nov "Submit". Captcha is left for a human to type;
  //      once they do, this auto-clicks Submit for them.
  //   2. Password + OTP - #password, a "Generate OTP" button (#resend), an
  //      #otp field (disabled until OTP generation kicks in) and
  //      #finalSubmit (disabled until #otp has a value). The OTP itself is
  //      auto-fetched from the credential's saved gemMailId the same way
  //      the bill-submission flow fetches its e-verify OTP - see
  //      FETCH_LOGIN_OTP in background.js.
  // Kept in chrome.storage.local across both pages (not cleared after page
  // 1) since submitting page 1's form navigates to page 2 as a real page
  // load, which would otherwise lose all in-memory state.
  async function checkPendingLogin() {
    const { data } = await chrome.runtime.sendMessage({ type: "GET_PENDING_LOGIN" });
    if (!data) return;

    // A stale pending login (tab closed/abandoned, then a later unrelated
    // GeM page loaded) shouldn't silently fill credentials into some other
    // page long after the button was clicked.
    if (Date.now() - data.startedAt > 10 * 60 * 1000) {
      chrome.runtime.sendMessage({ type: "CLEAR_PENDING_LOGIN" });
      return;
    }

    try {
      if ((data.step || "USERNAME") === "USERNAME") {
        await fillUsernameAndCaptchaStep(data);
      } else if (data.step === "PASSWORD") {
        await fillPasswordStep(data);
        chrome.runtime.sendMessage({ type: "CLEAR_PENDING_LOGIN" });
      }
    } catch (err) {
      console.error("[GeM Bill Auto-Submit] Login auto-fill fail hua:", err);
      chrome.runtime.sendMessage({ type: "CLEAR_PENDING_LOGIN" });
    }
  }

  // Reads an already-loaded captcha <img> through the OMS backend's Gemini
  // Vision OCR (/api/gem-captcha-ocr) instead of leaving it for the user to
  // type. Every GeM captcha seen so far is same-origin (served by the GeM
  // page itself), so drawing it to a canvas doesn't taint it - toDataURL
  // works without any CORS workaround. Any failure along the way (OCR call
  // fails, garbage/short result) just returns null - callers fall back to
  // their existing "wait for the user to type it" behavior unchanged.
  async function ocrCaptchaFromImage(img, omsOrigin) {
    if (!omsOrigin) {
      console.warn("[GeM Bill Auto-Submit] omsOrigin missing hai - captcha OCR call nahi ho sakta.");
      return null;
    }
    try {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);

      let imageDataUrl;
      try {
        imageDataUrl = canvas.toDataURL("image/png");
      } catch (err) {
        console.warn("[GeM Bill Auto-Submit] Captcha canvas se image nahi nikli:", err.message);
        return null;
      }

      // Called DIRECTLY (not relayed through background.js) - a background
      // service-worker fetch() risks getting cut off mid-request by MV3's
      // lifecycle limits (confirmed live 19-Sep-2026: "message channel
      // closed before a response was received" even with a keep-alive ping
      // running). This content script has no such limit; the OMS API route
      // sends permissive CORS headers itself to allow this cross-origin call
      // (see app/api/gem-captcha-ocr/route.ts).
      const res = await fetch(`${omsOrigin}/api/gem-captcha-ocr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.warn("[GeM Bill Auto-Submit] Captcha OCR fail hua:", errData.error || `status ${res.status}`);
        return null;
      }
      const data = await res.json();

      const text = String(data.text || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      return text.length === 6 ? text : null; // GeM's captcha text is always exactly 6 characters
    } catch (err) {
      console.warn("[GeM Bill Auto-Submit] Captcha OCR me error:", err.message);
      return null;
    }
  }

  // Finds the container holding a captcha image+input pair, anchored on a
  // known GeM caption phrase rather than a specific id/src - both of those
  // have been observed (confirmed live 19-Sep-2026 on the catalog Update
  // Stock page) to stop matching after GeM regenerates the captcha (a fresh
  // element, sometimes without preserving its id) or to never match at all
  // (the image rendered from a data: URI containing no literal "captcha"
  // text for a src match to find). GeM's own on-page caption text is
  // comparatively stable since it's user-facing copy, not a generated
  // id/src - captionRegex is whatever exact phrasing that particular page
  // uses (confirmed to differ: the login page says "Type the characters in
  // the box below", the catalog edit page says "Please enter the text shown
  // in the above image").
  function findCaptchaWidgetContainerByCaption(captionRegex) {
    // Walks raw TEXT NODES (not elements) - confirmed live 19-Sep-2026 that
    // requiring a childless leaf ELEMENT to match (the previous approach)
    // found nothing at all, most likely because the caption's own markup
    // wraps the text in something (an icon, a nested span) that this file
    // has no live DevTools inspection of yet. A TreeWalker over text nodes
    // finds the phrase regardless of whatever element structure wraps it.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let caption = null;
    let node;
    while ((node = walker.nextNode())) {
      if (captionRegex.test(node.textContent || "")) {
        caption = node.parentElement;
        break;
      }
    }
    if (!caption) return null;

    let container = caption;
    let hops = 0;
    while (container && hops < 6) {
      if (container.querySelector("img") && container.querySelector('input[type="text"], input:not([type])')) {
        return container;
      }
      container = container.parentElement;
      hops++;
    }
    return null;
  }

  function findCaptchaImageByCaption(captionRegex) {
    const container = findCaptchaWidgetContainerByCaption(captionRegex);
    if (!container) return null;
    return Array.from(container.querySelectorAll("img")).find((im) => isVisible(im) && im.complete && im.naturalWidth > 0) || null;
  }

  // Login page's captcha specifically - <img id="captcha1">, confirmed live
  // 19-Sep-2026 via DevTools on sso.gem.gov.in. Falls back to the caption-
  // anchored search above if that id doesn't match within a few seconds
  // (confirmed live 19-Sep-2026: this id sometimes doesn't match at all,
  // same failure mode observed on the catalog edit page's captcha).
  async function ocrCaptcha(omsOrigin) {
    const byId = await waitForElementMatching(() => {
      const el = document.getElementById("captcha1");
      return el && isVisible(el) && el.complete && el.naturalWidth > 0 ? el : null;
    }, 4000).catch(() => null);

    const img = byId || findCaptchaImageByCaption(/type the characters in the box below/i);
    if (!img) return null;

    return ocrCaptchaFromImage(img, omsOrigin);
  }

  async function fillUsernameAndCaptchaStep(data) {
    const usernameField = await waitForElement("#loginid", 10000).catch(() => null);
    if (!usernameField) {
      console.warn("[GeM Bill Auto-Submit] #loginid field nahi mila is page pe - login page ka structure badal gaya lagta hai.");
      return;
    }
    setNativeValue(usernameField, data.gemUserId);
    fireEvents(usernameField);
    console.log("[GeM Bill Auto-Submit] User ID fill kar diya. Captcha OCR se read karne ki koshish kar raha hu - nahi bana to manually daal dena, bharte hi Submit apne aap ho jayega.");

    const captchaField = await waitForElement("#captcha_math", 10000).catch(() => null);
    if (!captchaField) {
      console.warn("[GeM Bill Auto-Submit] #captcha_math field nahi mila - Submit manually dabana padega.");
      return;
    }

    // Debounced on the captcha field's own input event - waits for whoever
    // (OCR below, or the user typing) to stop changing it before treating it
    // as "filled in" and clicking Submit.
    const filled = new Promise((resolve) => {
      let debounceId;
      const onInput = () => {
        clearTimeout(debounceId);
        if (captchaField.value.trim().length < 6) return; // GeM's captcha text is 6 characters - don't submit on a partial entry
        debounceId = setTimeout(() => {
          captchaField.removeEventListener("input", onInput);
          resolve();
        }, 600);
      };
      captchaField.addEventListener("input", onInput);
    });

    // Fired in the background (not awaited here) so a slow OCR round-trip
    // never blocks a human who's already typing the captcha themselves.
    ocrCaptcha(data.omsOrigin).then((text) => {
      if (!text) return;
      console.log("[GeM Bill Auto-Submit] Captcha OCR se read kar liya:", text);
      setNativeValue(captchaField, text);
      fireEvents(captchaField);
    });

    await filled;

    const submitBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => isVisible(b) && /^submit$/i.test(b.textContent.trim())
    );
    if (!submitBtn) {
      console.warn("[GeM Bill Auto-Submit] Captcha bhar gaya par Submit button nahi mila - manually dabao.");
      return;
    }

    console.log("[GeM Bill Auto-Submit] Captcha bhar gaya, Submit click kar raha hu.");
    // Persisted BEFORE the click, since Submit navigates to page 2 as a real
    // page load - checkPendingLogin() on that next page reads this step to
    // know it should now fill the password instead of the username again.
    await chrome.runtime.sendMessage({ type: "SET_PENDING_LOGIN_STEP", step: "PASSWORD" });
    submitBtn.click();
  }

  // Password page (confirmed live 24-Aug-2026): #password, a "Generate OTP"
  // button (#resend), an #otp field that's disabled until OTP generation
  // kicks in, and #finalSubmit which is disabled until #otp has a value.
  async function fillPasswordStep(data) {
    const passwordField = await waitForElement("#password", 10000).catch(() => null);
    if (!passwordField) {
      console.warn("[GeM Bill Auto-Submit] #password field nahi mila is page pe.");
      return;
    }
    setNativeValue(passwordField, data.gemPassword);
    fireEvents(passwordField);
    console.log("[GeM Bill Auto-Submit] Password fill kar diya.");

    const generateOtpBtn = await waitForElement("#resend", 10000).catch(() => null);
    if (!generateOtpBtn) {
      console.warn("[GeM Bill Auto-Submit] #resend (Generate OTP) button nahi mila - manually 'Generate OTP' dabao.");
      return;
    }

    const sinceTs = Date.now() - 5000; // small buffer for clock skew, same idea as the bill-submission OTP fetch
    console.log("[GeM Bill Auto-Submit] Generate OTP click kar raha hu.");
    generateOtpBtn.click();

    if (!data.gemMailId) {
      console.warn("[GeM Bill Auto-Submit] Is credential ka Mail ID save nahi hai - OTP manually daal ke Submit karo.");
      return;
    }

    const otpField = await waitForElementMatching(() => {
      const el = document.querySelector("#otp");
      return el && isVisible(el) && !el.disabled ? el : null;
    }, 20000).catch(() => null);
    if (!otpField) {
      console.warn("[GeM Bill Auto-Submit] #otp field enable nahi hua - manually daal ke Submit karo.");
      return;
    }

    console.log(`[GeM Bill Auto-Submit] "${data.gemMailId}" se OTP fetch kar raha hu...`);
    const otpResponse = await chrome.runtime.sendMessage({ type: "FETCH_LOGIN_OTP", gemMailId: data.gemMailId, sinceTs });
    if (!otpResponse?.success) {
      console.warn("[GeM Bill Auto-Submit] OTP fetch fail hua:", otpResponse?.error, "- manually daal ke Submit karo.");
      return;
    }

    setNativeValue(otpField, otpResponse.otp);
    fireEvents(otpField);
    console.log("[GeM Bill Auto-Submit] OTP fill kar diya:", otpResponse.otp);

    const submitBtn = await waitForElementMatching(() => {
      const el = document.querySelector("#finalSubmit");
      return el && isVisible(el) && !el.disabled ? el : null;
    }, 10000).catch(() => null);
    if (!submitBtn) {
      console.warn("[GeM Bill Auto-Submit] #finalSubmit enable nahi hua - manually Submit dabao.");
      return;
    }

    console.log("[GeM Bill Auto-Submit] Login Submit click kar raha hu.");
    submitBtn.click();
  }

  // ===== Sync Checklist "Sync" button: update Rate/Stock/Min Qty on GeM =====
  // Reuses the exact same login (username/captcha, then password/OTP) as
  // checkPendingLogin() above, but keeps going after login instead of
  // stopping - navigates to admin-mkp.gem.gov.in's Catalogue Search, finds
  // the product by Product ID, updates its Offer Price, then (assumed to be
  // further down the SAME edit page, based on isStockUpdatePage()'s own
  // detection needing no special URL) fills Current Stock / Min Qty Per
  // Consignee too. NOT YET CONFIRMED LIVE - built from screenshots + the
  // navigation steps described directly, not from DevTools inspection like
  // the rest of this file. Expect to need real-run adjustments; every step
  // logs clearly and degrades to "do this bit manually" rather than silently
  // failing, same as the rest of this file.
  const CATALOGUE_INDEX_URL = "https://admin-mkp.gem.gov.in/#!/catalog/index";

  // Tab is opened straight at CATALOGUE_INDEX_URL (see handleUpdateGemCatalogueItem
  // in background.js) instead of the SSO login page, so this can tell the two
  // cases apart on load: a session for SOME GeM account is already active ->
  // the Catalogue Search UI renders directly, no login needed at all; not
  // logged in -> GeM's own auth redirect lands on the #loginid page instead.
  // Whichever shows up first wins the race. NOT YET CONFIRMED LIVE (same
  // caveat as the rest of this catalogue-update flow) - if GeM's actual
  // logged-out behavior on this URL turns out different, this will need
  // adjusting from a real run.
  async function detectAlreadyLoggedIn() {
    const result = await Promise.race([
      waitForElement("#loginid", 8000).then(() => "LOGIN_FORM").catch(() => null),
      waitForElementMatching(() => {
        const heading = Array.from(document.querySelectorAll("h1,h2,h3,h4,legend,label")).find((h) => /catalogue search/i.test(h.textContent));
        return heading ? "CATALOGUE" : null;
      }, 8000).catch(() => null),
    ]);
    return result === "CATALOGUE";
  }

  async function checkPendingCatalogueUpdate() {
    const { data } = await chrome.runtime.sendMessage({ type: "GET_PENDING_CATALOGUE_UPDATE" });
    if (!data) return;

    if (Date.now() - data.startedAt > 15 * 60 * 1000) {
      chrome.runtime.sendMessage({ type: "CLEAR_PENDING_CATALOGUE_UPDATE" });
      return;
    }

    try {
      const step = data.step || "LOGIN_USERNAME";

      // Two modes share this whole state machine and diverge only once login
      // is settled: "update" edits an offering this firm already has (Catalogue
      // Search -> Product ID -> Rate/Stock), "publish" creates one that does not
      // exist yet (marketplace product page -> SELL THIS ITEM -> ... -> OTP).
      // Keeping them on one pendingCatalogueUpdate record means the login half
      // (username+captcha, password+OTP, already-logged-in detection) is one
      // code path, not two that drift apart.
      const afterLogin = async (needsNavigation) => {
        if (data.mode === "publish") {
          console.log("[GeM Bill Auto-Submit] Login settled - product page par ja raha hu:", data.productUrl);
          await setCatalogueStep(data, "PUBLISH_SELL_ITEM");
          window.location.href = data.productUrl;
          return;
        }
        await setCatalogueStep(data, "CATALOGUE_SEARCH");
        if (needsNavigation) {
          window.location.href = CATALOGUE_INDEX_URL;
        } else {
          await catalogueSearchStep(data);
        }
      };

      if (step === "LOGIN_USERNAME") {
        if (await detectAlreadyLoggedIn()) {
          console.log("[GeM Bill Auto-Submit] GeM me pehle se login hai (session already active) - login skip kar raha hu.");
          // Already sitting on the catalogue index, so update mode needs no navigation.
          await afterLogin(false);
        } else {
          await catalogueLoginUsernameStep(data);
        }
      } else if (step === "LOGIN_PASSWORD") {
        await catalogueLoginPasswordStep(data);
      } else if (step === "CATALOGUE_NAV") {
        console.log("[GeM Bill Auto-Submit] Login ho gaya, aage badh raha hu...");
        await afterLogin(true);
      } else if (step === "CATALOGUE_SEARCH") {
        await catalogueSearchStep(data);
      } else if (step === "RATE_UPDATE") {
        await catalogueRateUpdateStep(data);
      } else if (step === "STOCK_UPDATE") {
        await catalogueStockUpdateStep(data);
      } else if (step === "PUBLISH_SELL_ITEM") {
        // Confirmed live: pendingCatalogueUpdate persists up to 15 minutes
        // (see the timeout check above) and checkPendingCatalogueUpdate runs
        // on every matched GeM page, not just the one a step expects - a
        // stale "publish" state re-ran this exact step's element search on
        // fulfilment.gem.gov.in (nothing to do with the product page at
        // all), logging a confusing "SELL THIS ITEM button nahi mila"
        // warning with nothing the user could act on. Each PUBLISH_* step
        // below only runs on the host it's actually meant for - on any other
        // page it just waits quietly for the right one instead of warning
        // about something that was never supposed to be there.
        if (location.hostname === "mkp.gem.gov.in") await publishSellItemStep(data);
      } else if (step === "PUBLISH_PAIR_CONFIRM") {
        if (location.hostname === "admin-mkp.gem.gov.in") await publishPairConfirmStep(data);
      } else if (step === "PUBLISH_OFFERING") {
        if (location.hostname === "admin-mkp.gem.gov.in") await publishOfferingStep(data);
      } else if (step === "PUBLISH_TERMS") {
        if (location.hostname === "admin-mkp.gem.gov.in") await publishTermsStep(data);
      } else if (step === "PUBLISH_OTP") {
        if (location.hostname === "admin-mkp.gem.gov.in") await publishOtpStep(data);
      }
    } catch (err) {
      console.error("[GeM Bill Auto-Submit] Catalogue update automation fail hua:", err);

      // A bulk run shouldn't block on alert() waiting for a human who may
      // not be watching this tab - one item failing (unexpectedly, not just
      // the captcha-retry-exhausted case catalogueStockUpdateStep already
      // handles) gets recorded and skipped instead, same as any other
      // failure in a batch. A single (non-bulk) sync keeps the original
      // alert-and-stop behavior, since there IS a human waiting on it here.
      const { pendingCatalogueQueue } = await chrome.storage.local.get("pendingCatalogueQueue");
      if (pendingCatalogueQueue && data.listingId) {
        await markFailedAndAdvance(data, err.message);
      } else {
        alert(`GeM catalogue update me error aaya: ${err.message}\n\nKripya manually complete karo, phir Sync Checklist me khud tick karo.`);
        chrome.runtime.sendMessage({ type: "CLEAR_PENDING_CATALOGUE_UPDATE" });
      }
    }
  }

  async function setCatalogueStep(data, step) {
    data.step = step;
    await chrome.runtime.sendMessage({ type: "SET_PENDING_CATALOGUE_UPDATE_STEP", step });
  }

  // Records why this item couldn't be synced (visible on its own Sync
  // Checklist row - see MARK_CHECKLIST_SYNC_FAILED in background.js), then
  // moves the bulk run on to whatever's next in the queue.
  async function markFailedAndAdvance(data, reason) {
    try {
      await chrome.runtime.sendMessage({ type: "MARK_CHECKLIST_SYNC_FAILED", omsOrigin: data.omsOrigin, listingId: data.listingId, reason });
    } catch (err) {
      console.warn("[GeM Bill Auto-Submit] OMS ko fail-mark bhejne me error:", err.message);
    }
    await tryAdvanceQueue();
  }

  // Asks background.js whether another item is queued (see
  // advanceCatalogueQueue in background.js) - a no-op returning false if
  // this run was never part of a bulk batch to begin with. Navigating back
  // to CATALOGUE_INDEX_URL re-triggers checkPendingCatalogueUpdate fresh for
  // whichever item advanceCatalogueQueue just made current.
  async function tryAdvanceQueue() {
    const response = await chrome.runtime.sendMessage({ type: "ADVANCE_CATALOGUE_QUEUE" }).catch(() => ({ hasNext: false }));
    if (response?.hasNext) {
      console.log("[GeM Bill Auto-Submit] Bulk run - agla item process kar raha hu.");
      window.location.href = CATALOGUE_INDEX_URL;
      return true;
    }
    return false;
  }

  // Same #loginid/#captcha_math page as checkPendingLogin's username step,
  // just advancing pendingCatalogueUpdate's own step instead.
  async function catalogueLoginUsernameStep(data) {
    const usernameField = await waitForElement("#loginid", 10000).catch(() => null);
    if (!usernameField) {
      console.warn("[GeM Bill Auto-Submit] #loginid field nahi mila.");
      return;
    }
    setNativeValue(usernameField, data.gemUserId);
    fireEvents(usernameField);
    console.log("[GeM Bill Auto-Submit] (Catalogue update) User ID fill kar diya. Captcha OCR se read karne ki koshish kar raha hu.");

    const captchaField = await waitForElement("#captcha_math", 10000).catch(() => null);
    if (!captchaField) {
      console.warn("[GeM Bill Auto-Submit] #captcha_math field nahi mila.");
      return;
    }

    const filled = new Promise((resolve) => {
      let debounceId;
      const onInput = () => {
        clearTimeout(debounceId);
        if (captchaField.value.trim().length < 6) return;
        debounceId = setTimeout(() => {
          captchaField.removeEventListener("input", onInput);
          resolve();
        }, 600);
      };
      captchaField.addEventListener("input", onInput);
    });

    ocrCaptcha(data.omsOrigin).then((text) => {
      if (!text) return;
      console.log("[GeM Bill Auto-Submit] (Catalogue update) Captcha OCR se read kar liya:", text);
      setNativeValue(captchaField, text);
      fireEvents(captchaField);
    });

    await filled;

    const submitBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => isVisible(b) && /^submit$/i.test(b.textContent.trim())
    );
    if (!submitBtn) {
      console.warn("[GeM Bill Auto-Submit] Submit button nahi mila.");
      return;
    }

    await setCatalogueStep(data, "LOGIN_PASSWORD");
    submitBtn.click();
  }

  // Same #password/#resend/#otp/#finalSubmit page as checkPendingLogin's
  // password step, but on success moves on to CATALOGUE_NAV instead of
  // stopping - this is the whole point of a separate pending state.
  async function catalogueLoginPasswordStep(data) {
    const passwordField = await waitForElement("#password", 10000).catch(() => null);
    if (!passwordField) {
      console.warn("[GeM Bill Auto-Submit] #password field nahi mila.");
      return;
    }
    setNativeValue(passwordField, data.gemPassword);
    fireEvents(passwordField);

    const generateOtpBtn = await waitForElement("#resend", 10000).catch(() => null);
    if (!generateOtpBtn) {
      console.warn("[GeM Bill Auto-Submit] #resend button nahi mila.");
      return;
    }

    const sinceTs = Date.now() - 5000;
    generateOtpBtn.click();

    if (!data.gemMailId) {
      console.warn("[GeM Bill Auto-Submit] Mail ID save nahi hai - OTP manually daalo.");
      return;
    }

    const otpField = await waitForElementMatching(() => {
      const el = document.querySelector("#otp");
      return el && isVisible(el) && !el.disabled ? el : null;
    }, 20000).catch(() => null);
    if (!otpField) {
      console.warn("[GeM Bill Auto-Submit] #otp field enable nahi hua.");
      return;
    }

    const otpResponse = await chrome.runtime.sendMessage({ type: "FETCH_LOGIN_OTP", gemMailId: data.gemMailId, sinceTs });
    if (!otpResponse?.success) {
      console.warn("[GeM Bill Auto-Submit] OTP fetch fail hua:", otpResponse?.error);
      return;
    }
    setNativeValue(otpField, otpResponse.otp);
    fireEvents(otpField);

    const submitBtn = await waitForElementMatching(() => {
      const el = document.querySelector("#finalSubmit");
      return el && isVisible(el) && !el.disabled ? el : null;
    }, 10000).catch(() => null);
    if (!submitBtn) {
      console.warn("[GeM Bill Auto-Submit] #finalSubmit enable nahi hua.");
      return;
    }

    await setCatalogueStep(data, "CATALOGUE_NAV");
    submitBtn.click();
  }

  // Finds an <input> whose nearby row/label text matches labelRegex and sets
  // its value - the write-side counterpart of the same label-proximity
  // approach GEM-LINK-FETCH's content.js already uses to READ Current
  // Stock/Min Qty (those fields have no stable id, per its own notes).
  function setLabeledInputValue(labelRegex, value) {
    const inputs = document.querySelectorAll(
      'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="file"])'
    );
    for (const input of inputs) {
      let el = input.closest("tr") || input.parentElement;
      let hops = 0;
      while (el && hops < 4) {
        const text = el.textContent.trim();
        // Was capped at 300 - confirmed live 01-Sep-2026 this rejected the
        // real "Offer Price Including Tax..." container on any listing
        // showing GeM's 30-day price-increase-restriction note ("The price
        // entered cant be increased for the next 30 days. You have last
        // changed the price at ..."), since that note alone pushes the
        // combined container text past 300 chars even though the label
        // regex itself matched fine. Still bounded by the 4-hop walk above,
        // so this isn't opening the match up page-wide.
        if (text.length < 600 && labelRegex.test(text)) {
          simulateTyping(input, String(value));
          return true;
        }
        el = el.parentElement;
        hops++;
      }
    }
    return false;
  }

  // Confirmed live 01-Sep-2026 (DevTools inspection of the catalog edit
  // page): Current Stock / Min Qty / Rate are AngularJS 1.x inputs
  // (ng-model, not modern Angular) carrying a custom ng-number-only /
  // only-int / is-non-negative directive. That directive appears to hook
  // actual keyboard events rather than reacting to the final .value, so
  // setNativeValue + a single synthetic "input" event left them
  // ng-pristine/ng-untouched no matter what - GeM never registered the
  // change even though the digits were visibly sitting in the field. This
  // clears the field then re-types the target value one character at a
  // time with a real keydown/keypress/input/keyup sequence per digit, the
  // same shape the directive would see from actual typing.
  function simulateTyping(el, value) {
    el.focus();
    setNativeValue(el, "");
    el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "deleteContentBackward" }));

    for (const ch of String(value)) {
      const keyInit = { key: ch, bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyboardEvent("keydown", keyInit));
      el.dispatchEvent(new KeyboardEvent("keypress", keyInit));
      setNativeValue(el, el.value + ch);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, data: ch, inputType: "insertText" }));
      el.dispatchEvent(new KeyboardEvent("keyup", keyInit));
    }

    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function findButtonByText(textRegex) {
    return Array.from(document.querySelectorAll("button, a.btn, input[type=submit]")).find(
      (b) => isVisible(b) && textRegex.test((b.textContent || b.value || "").trim())
    );
  }

  function clickButtonByText(textRegex) {
    const btn = findButtonByText(textRegex);
    if (btn) btn.click();
    return !!btn;
  }

  // Same isTrusted problem publishSellItemStep already hit and fixed for
  // "SELL THIS ITEM" (see its own comment further down) - a plain .click()
  // silently does nothing, no error shown, just no reaction at all.
  // Confirmed live 19-Sep-2026 on the catalog edit page's "UPDATE STOCK"
  // button: its markup carries a custom `one-click` directive alongside
  // ng-click, whose naming strongly suggests it only reacts to a genuinely
  // trusted click event - exactly the kind of guard a script-dispatched
  // .click() (isTrusted: false) would silently fail. Goes straight to the
  // trusted click via chrome.debugger (same trustedClick() used there)
  // rather than trying a plain click first, since that's already confirmed
  // to do nothing useful for this specific button.
  async function trustedClickButtonByText(textRegex) {
    const btn = findButtonByText(textRegex);
    if (!btn) return false;

    btn.scrollIntoView({ block: "center" });
    await sleep(200);
    const rect = btn.getBoundingClientRect();
    const result = await chrome.runtime
      .sendMessage({ type: "TRUSTED_CLICK", x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      .catch((err) => ({ success: false, error: err.message }));

    if (!result?.success) {
      console.warn("[GeM Bill Auto-Submit] Trusted click fail hua:", result?.error, "- plain click try kar raha hu.");
      btn.click();
    }
    return true;
  }

  function escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Pushes a visible banner onto the OMS tab. Every "do this bit by hand"
  // message in the publish flow goes through here as well as the console -
  // the person is watching the GeM tab, not DevTools.
  async function notifyOms(data, text) {
    if (!data?.omsOrigin) return;
    try {
      await chrome.runtime.sendMessage({ type: "NOTIFY_OMS", omsOrigin: data.omsOrigin, text });
    } catch (err) {
      console.warn("[GeM Bill Auto-Submit] OMS banner bhejne me error:", err.message);
    }
  }

  // Finds a checkbox by its nearby label text and ticks it (a real .click(),
  // not setting .checked directly - Angular's checkbox binding listens for
  // the native click/change event, same reasoning setNativeValue uses for
  // text inputs). Leaves it alone if already checked, and leaves every OTHER
  // checkbox on the page untouched.
  function checkCheckboxByLabel(labelRegex) {
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    for (const cb of checkboxes) {
      if (!isVisible(cb)) continue;
      const container = cb.closest("div, td, li, label, form") || cb.parentElement;
      const text = container ? container.textContent.trim() : "";
      if (labelRegex.test(text)) {
        if (!cb.checked) cb.click();
        return true;
      }
    }
    return false;
  }

  // admin-mkp.gem.gov.in/#!/catalog/index - the "Catalogue Search" box seen
  // on the Published-listings page. Searches by Product ID, then clicks that
  // row's own edit (pencil) action to reach the catalog/new?id=... page.
  async function catalogueSearchStep(data) {
    const searchInput = await waitForElementMatching(() => {
      const heading = Array.from(document.querySelectorAll("h1,h2,h3,h4,legend,label")).find((h) => /catalogue search/i.test(h.textContent));
      if (!heading) return null;
      const container = heading.closest("div") || heading.parentElement;
      return container ? container.querySelector('input[type="text"], input:not([type])') : null;
    }, 15000).catch(() => null);

    if (!searchInput) {
      console.warn("[GeM Bill Auto-Submit] Catalogue Search box nahi mila.");
      await markFailedAndAdvance(data, "Catalogue Search box nahi mila.");
      return;
    }

    setNativeValue(searchInput, data.productId);
    fireEvents(searchInput);

    const clicked = clickButtonByText(/^search$/i);
    if (!clicked) {
      console.warn("[GeM Bill Auto-Submit] Search button nahi mila.");
      await markFailedAndAdvance(data, "Search button nahi mila.");
      return;
    }

    // Wait for a results row containing this Product ID, then click its edit link.
    const editLink = await waitForElementMatching(() => {
      const rows = document.querySelectorAll("table tbody tr");
      for (const tr of rows) {
        if (tr.textContent.includes(data.productId)) {
          return tr.querySelector('a[href*="catalog/new"]') || tr.querySelector("td:last-child a") || tr.querySelector("a");
        }
      }
      return null;
    }, 15000).catch(() => null);

    if (!editLink) {
      console.warn(`[GeM Bill Auto-Submit] Product ID "${data.productId}" search results me nahi mila.`);
      await markFailedAndAdvance(data, `Product ID "${data.productId}" search results me nahi mila.`);
      return;
    }

    await setCatalogueStep(data, "RATE_UPDATE");
    editLink.click();

    // BUG FIXED 01-Sep-2026: this click is an Angular hash-route SPA
    // navigation (still admin-mkp.gem.gov.in, just #!/catalog/index ->
    // #!/catalog/new?id=...) - confirmed live it does NOT reload the page,
    // so nothing was ever re-triggering checkPendingCatalogueUpdate() for
    // the next step the way a real navigation would (like CATALOGUE_NAV's
    // window.location.href does, which DOES reload). The flow silently
    // stopped right here every single run. Chaining directly into
    // catalogueRateUpdateStep - once the edit page's own content has
    // actually rendered - matches how RATE_UPDATE already chains into
    // STOCK_UPDATE below.
    const editPageReady = await waitForElementMatching(() => {
      return Array.from(document.querySelectorAll("label, h1, h2, h3, h4")).find((h) => /offer price including tax|terms of delivery/i.test(h.textContent))
        ? true
        : null;
    }, 15000).catch(() => null);

    if (!editPageReady) {
      console.warn("[GeM Bill Auto-Submit] Edit page load hone ka wait karte hue timeout ho gaya - manually complete karo.");
      await markFailedAndAdvance(data, "Edit page load hone ka wait karte hue timeout ho gaya.");
      return;
    }

    await catalogueRateUpdateStep(data);
  }

  // catalog/new?id=... edit page - "Offer Price Including Tax and Duties as
  // INR" field. GeM blocks a price INCREASE for 30 days after the last
  // change (own on-page text, seen live: "The price entered cant be
  // increased for the next 30 days") - detected and logged rather than
  // treated as a hard failure, since a decrease or an unrelated Stock/Min
  // Qty update should still go through.
  async function catalogueRateUpdateStep(data) {
    if (data.newRate === undefined || data.newRate === null) {
      console.log("[GeM Bill Auto-Submit] Naya Rate nahi diya gaya - is step ko skip kar raha hu.");
      await setCatalogueStep(data, "STOCK_UPDATE");
      return;
    }

    const found = await waitForElementMatching(() => {
      return setLabeledInputValue(/offer price including tax/i, data.newRate) ? true : null;
    }, 15000).catch(() => null);

    if (!found) {
      console.warn("[GeM Bill Auto-Submit] Offer Price field nahi mila.");
    } else if (/price entered cant be increased|can increase the price only/i.test(document.body.textContent)) {
      console.warn(
        "[GeM Bill Auto-Submit] GeM ka 30-din price-increase restriction laga hua hai is product par - Rate update SKIP ho gaya, Stock/Min Qty phir bhi update hoga."
      );
    } else {
      // NOT an exact-text match ("save"/"update"/"submit" alone) - GeM's real
      // buttons here are multi-word (e.g. "UPDATE STOCK", confirmed live
      // 01-Sep-2026), so this needs to match one of those words ANYWHERE in
      // the button text, not the whole text.
      await saveWithCaptchaRetry(data.omsOrigin, /\b(save|update|submit)\b/i);
    }

    await setCatalogueStep(data, "STOCK_UPDATE");
    catalogueStockUpdateStep(data);
  }

  // Current Stock / Minimum Quantity Per Consignee - assumed to be further
  // down the SAME catalog/new?id=... edit page (isStockUpdatePage() in
  // GEM-LINK-FETCH's content.js detects them by body text alone, with no
  // separate URL, which is what this assumption is based on). If they
  // genuinely live on a different page reached some other way, this step
  // will find nothing and say so clearly rather than guess further.
  async function catalogueStockUpdateStep(data) {
    let didAnything = false;
    if (data.newStock !== undefined && data.newStock !== null) {
      didAnything = setLabeledInputValue(/current\s*stock.*maximum\s*quantity/i, data.newStock) || didAnything;
    }
    if (data.newMinQty !== undefined && data.newMinQty !== null) {
      didAnything = setLabeledInputValue(/minimum\s*quantity\s*per\s*consignee/i, data.newMinQty) || didAnything;
    }

    // Tracks whether this item genuinely went through, rather than assuming
    // success just because nothing threw - a captcha that never comes out
    // right after saveWithCaptchaRetry's own retries, or the fields not even
    // being found, both need to end up as MARK_CHECKLIST_SYNC_FAILED below,
    // not MARK_CHECKLIST_SYNCED (confirmed live 19-Sep-2026: this used to
    // mark a listing Synced unconditionally regardless of whether the save
    // actually succeeded).
    let succeeded = false;
    let failureReason = "";

    if (didAnything) {
      // "I confirm that all the details for my offering are up to date" -
      // GeM won't accept the update without this ticked (confirmed live
      // 01-Sep-2026). The "I have read and agree to... Undertaking" checkbox
      // right below it is deliberately left alone - it's a separate,
      // already-agreed-once term, not part of this per-update confirmation.
      const confirmed = checkCheckboxByLabel(/confirm that all the details for my offering are up to date/i);
      if (!confirmed) {
        console.warn('[GeM Bill Auto-Submit] "I confirm that all the details..." checkbox nahi mila - manually tick karo.');
      }

      // NOT an exact-text match - see the same note in catalogueRateUpdateStep
      // above (GeM's real button here is "UPDATE STOCK", confirmed live 01-Sep-2026).
      succeeded = await saveWithCaptchaRetry(data.omsOrigin, /\b(save|update|submit)\b/i);
      if (succeeded) {
        console.log("[GeM Bill Auto-Submit] Stock/Min Qty update kar diya.");
      } else {
        failureReason = "Captcha baar-baar galat/khali raha (3 attempts ke baad bhi).";
      }
    } else {
      failureReason = "Current Stock / Min Qty fields is page par nahi mile.";
      console.warn(`[GeM Bill Auto-Submit] ${failureReason} - manually update karo, phir Sync Checklist me khud tick karo.`);
    }

    if (succeeded) {
      try {
        await chrome.runtime.sendMessage({ type: "MARK_CHECKLIST_SYNCED", omsOrigin: data.omsOrigin, listingId: data.listingId });
        console.log("[GeM Bill Auto-Submit] OMS Sync Checklist me is item ko Synced mark kar diya.");
      } catch (err) {
        console.warn("[GeM Bill Auto-Submit] OMS ko sync-mark bhejne me error:", err.message);
      }
    } else {
      try {
        await chrome.runtime.sendMessage({ type: "MARK_CHECKLIST_SYNC_FAILED", omsOrigin: data.omsOrigin, listingId: data.listingId, reason: failureReason });
        console.log("[GeM Bill Auto-Submit] OMS Sync Checklist me is item ko failed mark kar diya:", failureReason);
      } catch (err) {
        console.warn("[GeM Bill Auto-Submit] OMS ko fail-mark bhejne me error:", err.message);
      }
    }

    // Bulk run - move on to whatever's next in the queue (a no-op if this
    // wasn't part of one). Only clear pendingCatalogueUpdate when nothing
    // follows - advanceCatalogueQueue already overwrote it with the NEXT
    // item's data when hasNext is true, so clearing here would wipe that out.
    const advanced = await tryAdvanceQueue();
    if (!advanced) {
      await chrome.runtime.sendMessage({ type: "CLEAR_PENDING_CATALOGUE_UPDATE" });
    }
  }

  // ===== New Upload Link "Publish to GeM": create a brand-new offering =====
  // Built from the step-by-step walkthrough + screenshots of a real run, not
  // from DevTools inspection, so every step degrades to a clear "do this bit
  // by hand" banner on the OMS tab rather than failing silently. The flow is:
  //   mkp product page -> SELL THIS ITEM
  //   admin-mkp catalog/new -> "pair with existing gem_catalog_id?" -> Ok
  //   offering form -> rate / stock / min qty / delivery state / undertaking
  //   -> SAVE / PROCEED -> REVIEW TERMS -> VALIDATE CATALOG AND PUBLISH
  //   -> OTP (fetched from the firm's Gmail) -> Verify OTP & PUBLISH

  // mkp.gem.gov.in/.../p-<id>-cat.html - the public product page. "SELL THIS
  // ITEM" starts a new offering against this existing catalogue and is a real
  // cross-origin navigation to admin-mkp, so the step is stored BEFORE the
  // click (a click-then-store race loses the step on fast navigations).
  async function publishSellItemStep(data) {
    const sellBtn = await waitForElementMatching(() => findButtonByText(/sell this item/i), 25000).catch(() => null);

    if (!sellBtn) {
      console.warn('[GeM Bill Auto-Submit] "SELL THIS ITEM" button nahi mila.');
      await notifyOms(data, '⚠️ GeM product page par "SELL THIS ITEM" nahi mila — manually dabao, aage ka step apne aap chalega.');
      return;
    }

    await setCatalogueStep(data, "PUBLISH_PAIR_CONFIRM");
    sellBtn.click();

    // Confirmed live: button IS found and .click() fires with no error, but
    // GeM's own page sometimes doesn't react to it (a real user clicking the
    // SAME button by hand navigates fine straight after) - most likely an
    // isTrusted check on GeM's side silently ignoring the script-dispatched
    // click. The step stays PUBLISH_PAIR_CONFIRM regardless of which of the
    // attempts below actually lands - a click here leads to the exact same
    // next screen either way.
    await sleep(2500);
    if (location.hostname !== "mkp.gem.gov.in") return; // it worked, page has already navigated on

    console.warn('[GeM Bill Auto-Submit] Plain click kaam nahi kiya - genuinely trusted click try kar raha hu (chrome.debugger).');
    sellBtn.scrollIntoView({ block: "center" });
    await sleep(300);
    const rect = sellBtn.getBoundingClientRect();
    const trustedResult = await chrome.runtime
      .sendMessage({ type: "TRUSTED_CLICK", x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      .catch((err) => ({ success: false, error: err.message }));

    await sleep(2500);
    if (location.hostname !== "mkp.gem.gov.in") return; // trusted click worked

    console.warn('[GeM Bill Auto-Submit] Trusted click bhi kaam nahi kiya:', trustedResult?.error);
    await notifyOms(data, '⚠️ "SELL THIS ITEM" apne aap click nahi ho paya - is page par khud dabao, aage ka step apne aap chalega.');
  }

  // admin-mkp catalog/new?...&gem_catalog_id=... - GeM asks "A gem catalog
  // exists with this gem_catalog_id. Do you want to pair with it?". Pairing is
  // the whole point (we are selling against THAT catalogue), so Ok. If the
  // dialog never shows, GeM went straight to the form - not an error.
  async function publishPairConfirmStep(data) {
    const okBtn = await waitForElementMatching(() => {
      if (!/gem catalog exists with this gem_catalog_id/i.test(document.body.textContent || "")) return null;
      return findButtonByText(/^ok$/i);
    }, 20000).catch(() => null);

    if (okBtn) {
      okBtn.click();
      await sleep(2000);
    } else {
      console.log("[GeM Bill Auto-Submit] Pair-confirm dialog nahi aaya - seedha form par ja raha hu.");
    }

    // Angular renders the form in place (no reload), so chain rather than
    // waiting for a page load that will never come.
    await setCatalogueStep(data, "PUBLISH_OFFERING");
    await publishOfferingStep(data);
  }

  // The offering form. Same three numeric fields the Stock Update flow fills
  // (catalogueRateUpdateStep / catalogueStockUpdateStep use these exact
  // labels), plus the delivery state and the undertaking checkbox.
  async function publishOfferingStep(data) {
    const formReady = await waitForElementMatching(() => {
      return /terms of delivery|minimum quantity per consignee/i.test(document.body.textContent || "") ? true : null;
    }, 30000).catch(() => null);

    if (!formReady) {
      console.warn("[GeM Bill Auto-Submit] Offering form render nahi hua.");
      await notifyOms(data, "⚠️ GeM ka offering form nahi khula — manually bhar do.");
      return;
    }

    const missed = [];

    if (data.newRate !== undefined && data.newRate !== null) {
      if (!setLabeledInputValue(/offer price including tax/i, data.newRate)) missed.push("Offer Price");
    }
    if (data.newStock !== undefined && data.newStock !== null) {
      if (!setLabeledInputValue(/current\s*stock.*maximum\s*quantity/i, data.newStock)) missed.push("Current Stock");
    }
    if (data.newMinQty !== undefined && data.newMinQty !== null) {
      if (!setLabeledInputValue(/minimum\s*quantity\s*per\s*consignee/i, data.newMinQty)) missed.push("Min Qty Per Consignee");
    }

    // Delivery state - the State table's checkbox cell carries just the state
    // name, so a word-boundary match on it hits the right cell and nothing else.
    const state = data.state || "Gujarat";
    if (!checkCheckboxByLabel(new RegExp("\\b" + escapeRegex(state) + "\\b", "i"))) {
      missed.push(`State "${state}"`);
    }

    // "I have read and agree to all the terms of the Undertaking." Ticking it
    // pops the Chain Documents Undertaking modal on top of the form, which
    // blocks SAVE / PROCEED until it is dismissed.
    if (!checkCheckboxByLabel(/read and agree to all the terms of the undertaking/i)) {
      missed.push("Undertaking checkbox");
    } else {
      const closeBtn = await waitForElementMatching(() => {
        if (!/verification for chain documents undertaking/i.test(document.body.textContent || "")) return null;
        return (
          findButtonByText(/^(x|×|close)$/i) ||
          document.querySelector('.modal.in [data-dismiss="modal"], .modal[style*="block"] .close, .modal-header .close')
        );
      }, 8000).catch(() => null);

      if (closeBtn) {
        closeBtn.click();
        await sleep(800);
      }
    }

    if (missed.length) {
      console.warn("[GeM Bill Auto-Submit] Ye fields khud nahi bhare ja sake:", missed.join(", "));
      await notifyOms(data, `⚠️ GeM form me ye khud nahi bhara: ${missed.join(", ")} — manually bhar ke SAVE/PROCEED dabao.`);
    }

    await waitForCaptchaIfPresent(data.omsOrigin);

    if (!clickButtonByText(/save\s*\/?\s*proceed/i)) {
      console.warn("[GeM Bill Auto-Submit] SAVE / PROCEED button nahi mila.");
      await notifyOms(data, "⚠️ GeM par SAVE / PROCEED nahi mila — manually dabao.");
      return;
    }

    await sleep(2500);
    await setCatalogueStep(data, "PUBLISH_TERMS");
    await publishTermsStep(data);
  }

  // Category terms block at the bottom of the same page: REVIEW TERMS AND
  // CONDITIONS reveals the agreement checkbox, which in turn enables
  // VALIDATE CATALOG AND PUBLISH (GeM's own on-page note says as much:
  // "Click to enable publish button").
  async function publishTermsStep(data) {
    const reviewBtn = await waitForElementMatching(() => findButtonByText(/review terms and conditions/i), 25000).catch(() => null);
    if (reviewBtn) {
      reviewBtn.click();
      await sleep(1500);
    } else {
      console.log("[GeM Bill Auto-Submit] REVIEW TERMS AND CONDITIONS button nahi mila - shayad pehle se reviewed hai.");
    }

    const agreed = await waitForElementMatching(() => {
      return checkCheckboxByLabel(/read and agreed to all terms and conditions of government e-marketplace/i) ? true : null;
    }, 15000).catch(() => null);

    if (!agreed) {
      console.warn("[GeM Bill Auto-Submit] Terms agreement checkbox nahi mila.");
      await notifyOms(data, "⚠️ GeM ka terms-agreement checkbox nahi mila — manually tick karke PUBLISH dabao.");
      return;
    }
    await sleep(800);

    // Clock skew buffer, same as the login/bill OTP fetches - and taken BEFORE
    // the click so the mail this triggers is definitely newer than the cutoff.
    const otpSinceTs = Date.now() - 5000;

    if (!clickButtonByText(/validate catalog and publish/i)) {
      console.warn("[GeM Bill Auto-Submit] VALIDATE CATALOG AND PUBLISH button nahi mila.");
      await notifyOms(data, "⚠️ GeM par VALIDATE CATALOG AND PUBLISH nahi mila — manually dabao.");
      return;
    }

    await setCatalogueStep(data, "PUBLISH_OTP");
    await publishOtpStep(data, otpSinceTs);
  }

  // GeM's publish OTP goes to the firm's registered mobile AND email. The
  // email half is the one this can read, using the same Gmail token store the
  // login/e-verify OTP fetches use. sinceTs defaults wide only when this step
  // is resumed after a reload - normally publishTermsStep passes the exact
  // moment the OTP was requested, so an older OTP mail can never be picked up.
  async function publishOtpStep(data, sinceTs = Date.now() - 90 * 1000) {
    const otpField = await waitForElementMatching(() => {
      const el = Array.from(document.querySelectorAll('input[type="text"], input:not([type])')).find(
        (inp) => isVisible(inp) && /verification code|enter otp/i.test(inp.placeholder || "")
      );
      return el && !el.disabled ? el : null;
    }, 30000).catch(() => null);

    if (!otpField) {
      console.warn("[GeM Bill Auto-Submit] OTP box nahi mila.");
      await notifyOms(data, "⚠️ GeM ka OTP box nahi mila — OTP manually daal ke publish karo.");
      return;
    }

    if (!data.gemMailId) {
      console.warn("[GeM Bill Auto-Submit] Is firm ka Mail ID save nahi hai - OTP manually daalo.");
      await notifyOms(data, "⚠️ Is firm ka Mail ID GeM Login Setup me save nahi hai — OTP manually daal ke publish karo.");
      return;
    }

    const otpResponse = await chrome.runtime.sendMessage({ type: "FETCH_LOGIN_OTP", gemMailId: data.gemMailId, sinceTs });
    if (!otpResponse?.success) {
      console.warn("[GeM Bill Auto-Submit] OTP fetch fail hua:", otpResponse?.error);
      await notifyOms(data, `⚠️ OTP mail se nahi mil paya (${otpResponse?.error || "unknown"}) — manually daal ke publish karo.`);
      return;
    }

    setNativeValue(otpField, otpResponse.otp);
    fireEvents(otpField);
    await sleep(500);

    if (!clickButtonByText(/verify otp\s*&?\s*publish/i)) {
      console.warn("[GeM Bill Auto-Submit] 'Verify OTP & PUBLISH' button nahi mila.");
      await notifyOms(data, "⚠️ 'Verify OTP & PUBLISH' button nahi mila — OTP bhar diya hai, manually publish dabao.");
      return;
    }

    await sleep(4000);
    console.log("[GeM Bill Auto-Submit] Catalogue publish kar diya.");

    try {
      await chrome.runtime.sendMessage({ type: "MARK_NEW_LINK_PUBLISHED", omsOrigin: data.omsOrigin, entryId: data.entryId });
      await notifyOms(data, "✅ GeM par listing publish ho gayi — New Upload Link row Stock Update me chali gayi.");
    } catch (err) {
      console.warn("[GeM Bill Auto-Submit] OMS ko publish-mark bhejne me error:", err.message);
    }

    await chrome.runtime.sendMessage({ type: "CLEAR_PENDING_CATALOGUE_UPDATE" });
  }

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

    // Supply Type only shows up (and is mandatory) for Tax Invoice/Regular-
    // scheme firms - Composition/Without-GST bills never have this field.
    // Driven by the same CGST_SGST/IGST decision OMS already made for the
    // bill itself (gstSplit) rather than re-deriving it here - falls back to
    // a plain "is the buyer in Gujarat" check (the seller firm's own state,
    // hardcoded above) only if gstSplit wasn't passed through. Confirmed
    // live 25-Aug-2026.
    if (data.billType === "TAX_INVOICE") {
      const isIntraState = data.gstSplit
        ? data.gstSplit === "CGST_SGST"
        : /gujarat/i.test(data.buyerState || "");
      await setSelectValueByIdWithRetry(
        "INVOICE_CREATION_FORM-SUPPLY_TYPE",
        isIntraState ? "Intra-State" : "Inter-State"
      );
    }

    // Re-assert the invoice number as the LAST field touched before
    // CONTINUE. It's set FIRST above, but everything filled after it here
    // (Billing Address, Place of Supply, State/UT Code) is exactly the kind
    // of dependent-field change GeM's own form logic sometimes reacts to by
    // silently resetting an earlier field - seen live: every other field
    // shows correctly filled, but SELL_INVOICE_NO is back to empty and
    // CONTINUE throws "Please fill all the mandatory fields" on an
    // otherwise-complete form. Re-querying by id instead of reusing the
    // earlier `invoiceNoInput` reference in case GeM re-rendered that node.
    const invoiceNoInputFinal = document.getElementById("INVOICE_CREATION_FORM-SELL_INVOICE_NO");
    if (invoiceNoInputFinal) {
      setNativeValue(invoiceNoInputFinal, data.billNo);
      fireEvents(invoiceNoInputFinal);
      if (invoiceNoInputFinal.value !== String(data.billNo)) {
        console.warn(
          "[GeM Bill Auto-Submit] Invoice number field still doesn't hold the expected value right before CONTINUE:",
          { expected: data.billNo, actual: invoiceNoInputFinal.value }
        );
      }
    } else {
      console.warn("[GeM Bill Auto-Submit] #INVOICE_CREATION_FORM-SELL_INVOICE_NO not found for the final re-assert.");
    }

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
    // quantity, never partial, even if goods shipped in batches. Both the
    // figure's text and the input field itself can still be missing right
    // when this step starts (Product Details renders asynchronously right
    // after Invoice Details' CONTINUE click) - retry both instead of a
    // single immediate attempt, which was silently leaving Supplied Qty
    // empty ("Invalid qty") and Preview stuck disabled.
    const pendingQty = await getPendingQtyFromPageWithRetry();
    const suppliedQtyValue = pendingQty || String(firstItem?.qty ?? "");
    await setTextValueByIdWithRetry("INVOICE_ITEMS_FORM-SuppliedQty", suppliedQtyValue);

    await setSelectValueByIdWithRetry("INVOICE_ITEMS_FORM-GST_UQ_NAME", "NOS");

    if (data.billType === "TAX_INVOICE") {
      // Substring match (not exact) since GeM's option text format for the
      // percentage isn't confirmed (e.g. could be "5%" vs "5.00%").
      if (firstItem?.gstPercent !== undefined && firstItem?.gstPercent !== null) {
        await selectDropdownByIdSubstringWithRetry("INVOICE_ITEMS_FORM-TAX_RATE", `${firstItem.gstPercent}`);
      }
      if (firstItem?.hsnSac) {
        // Genuinely trusted typing via chrome.debugger, not a synthetic
        // event dispatch - see trustedTypeIntoField's own comment for why.
        await trustedTypeIntoFieldWithRetry("INVOICE_ITEMS_FORM-PRODUCT_HSN_CODE", firstItem.hsnSac);
      }
    }

    // Confirmed live 14-Sep-2026 via console: a ONE-SHOT re-assert of
    // Supplied Qty/HSN Code right before Preview still wasn't enough - both
    // fields logged "still doesn't hold the expected value" here. Turned out
    // to be two different problems: Supplied Qty can still get reset by GeM's
    // own async GST/tax recompute after Tax Rate is chosen (though GeM
    // usually restores its own correct value there anyway), while HSN Code's
    // real problem was the isTrusted issue fixed above via
    // trustedTypeIntoField (see its comment) - a 20-second continuous
    // re-write loop of the old synthetic-event setter confirmed live
    // 14-Sep-2026 that it never stuck even once, no matter how "real" the
    // dispatched events looked. This keeps polling and re-writing both
    // fields anyway as a safety net, right up until Preview is actually
    // enabled AND both fields still hold what's expected at that exact
    // moment - a time-based loop, not waitForElementMatching's
    // MutationObserver, since a framework setting .value as a JS property
    // (rather than the DOM attribute) may never fire a mutation event for
    // that observer to catch in the first place.
    const hsnExpected = data.billType === "TAX_INVOICE" ? (firstItem?.hsnSac || null) : null;
    const pollStart = Date.now();
    let previewBtn = null;
    while (Date.now() - pollStart < MAX_WAIT_MS) {
      const suppliedQtyField = document.getElementById("INVOICE_ITEMS_FORM-SuppliedQty");
      if (suppliedQtyField && suppliedQtyField.value !== suppliedQtyValue) {
        setTextValueById("INVOICE_ITEMS_FORM-SuppliedQty", suppliedQtyValue);
      }

      let hsnField = null;
      if (hsnExpected) {
        hsnField = document.getElementById("INVOICE_ITEMS_FORM-PRODUCT_HSN_CODE");
        if (hsnField && hsnField.value !== hsnExpected) {
          await trustedTypeIntoField("INVOICE_ITEMS_FORM-PRODUCT_HSN_CODE", hsnExpected);
          hsnField = document.getElementById("INVOICE_ITEMS_FORM-PRODUCT_HSN_CODE");
        }
      }

      const qtyOk = !!suppliedQtyField && suppliedQtyField.value === suppliedQtyValue;
      const hsnOk = !hsnExpected || (!!hsnField && hsnField.value === hsnExpected);
      const btn = document.getElementById("INVOICE_CREATION_FORM-PROCRESS_BTN"); // sic - GeM's own typo, see file header
      if (btn && isVisible(btn) && !btn.disabled && qtyOk && hsnOk) {
        previewBtn = btn;
        break;
      }
      await sleep(300);
    }

    if (!previewBtn) {
      console.warn(
        "[GeM Bill Auto-Submit] Preview never became clickable with Supplied Qty/HSN Code both holding their expected values within the timeout - clicking it anyway with whatever's currently in those fields.",
        {
          suppliedQty: document.getElementById("INVOICE_ITEMS_FORM-SuppliedQty")?.value,
          hsnSac: hsnExpected ? document.getElementById("INVOICE_ITEMS_FORM-PRODUCT_HSN_CODE")?.value : "(not required)",
        }
      );
      previewBtn = document.getElementById("INVOICE_CREATION_FORM-PROCRESS_BTN");
      if (!previewBtn) throw new Error(`Element "#INVOICE_CREATION_FORM-PROCRESS_BTN" ${MAX_WAIT_MS}ms me nahi mila.`);
    }
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
      gmailAccountEmail: data.gmailAccountEmail,
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

    // Confirmed live (22-Aug-2026): the Download Invoice button only exists
    // under the "Shipment wise" tab - stepSearchAndOpenOrder lands on
    // "Product wise" (GeM's default tab), which shows "Invoice: --" with no
    // download button at all, causing this step to time out looking for it.
    const shipmentWiseTab = await waitForElementByText(["a"], /shipment wise/i, MAX_WAIT_MS);
    shipmentWiseTab.click();
    await sleep(1200); // let the tab's content panel render

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
  //
  // Confirmed live 01-Sep-2026: the Rate/Stock/Min Qty fields on the catalog
  // edit page still showed ng-pristine/ng-untouched (Angular's own "nothing
  // changed here" state) after this ran, even though the typed-looking value
  // was visibly sitting in the field. Two likely causes fixed here: (1) a
  // plain `new Event("input")` isn't an InputEvent instance, and Angular's
  // NumberValueAccessor / some custom validators specifically check for a
  // real InputEvent rather than any Event named "input"; (2) Angular's
  // "touched" state is normally set on blur, but only AFTER a prior focus -
  // dispatching blur alone with no matching focus first can be a no-op for
  // that part of the tracked state on some form setups.
  function fireEvents(el) {
    el.dispatchEvent(new Event("focus", { bubbles: true }));
    el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  // ---- ID-based field helpers (confirmed real GeM field IDs) ----

  // Same temporarily-remove-disabled trick already used by setSelectValueById
  // below, now applied to text inputs too. HSN Code specifically is disabled
  // by GeM until Tax Rate is chosen just before this runs, and a value
  // written to a still-disabled Angular-bound input gets silently discarded
  // the next time Angular re-renders it (its model never picked up our
  // input/change events while [disabled] was set) - "Please Enter HSN Code
  // for product ..." even though the field briefly looked filled.
  function setTextValueById(id, value) {
    const el = document.getElementById(id);
    if (!el) return false;

    const wasDisabled = el.disabled;
    if (wasDisabled) el.removeAttribute("disabled");
    setNativeValue(el, value);
    fireEvents(el);
    if (wasDisabled) el.setAttribute("disabled", "disabled");
    return true;
  }

  // Text-input counterpart to setSelectValueByIdWithRetry below - a field
  // can still not exist in the DOM yet right after a tab switch inside
  // GeM's SPA (e.g. Product Details renders asynchronously once Invoice
  // Details' CONTINUE is clicked), so a single immediate setTextValueById
  // attempt can silently no-op and leave a required field empty/"Invalid".
  async function setTextValueByIdWithRetry(id, value, timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (setTextValueById(id, value)) return true;
      await sleep(300);
    }
    console.warn(`[GeM Bill Auto-Submit] #${id} never appeared to fill "${value}" after ${timeoutMs}ms.`);
    return false;
  }

  // Genuinely trusted typing (same chrome.debugger escape hatch as
  // TRUSTED_CLICK/trustedClick below, this time via CDP's Input.insertText).
  // This is the actual fix for HSN Code: confirmed live 14-Sep-2026 that even
  // typeCharByCharById's full synthetic keydown/input/keyup sequence never
  // got GeM's own validation to accept the value - not once, across a
  // 20-second continuous re-write loop - while the exact same text typed by
  // hand worked immediately. Every script-dispatched event is isTrusted:false;
  // GeM's page apparently checks that specifically for this field. Focuses
  // the field itself first (plain .focus() isn't gated the way keystrokes
  // are), then asks the background script to actually type via CDP. Falls
  // back to the synthetic char-by-char approach if chrome.debugger can't
  // attach (e.g. DevTools already open on this tab blocks debugger attach).
  async function trustedTypeIntoField(id, value) {
    const el = document.getElementById(id);
    if (!el) return false;

    const wasDisabled = el.disabled;
    if (wasDisabled) el.removeAttribute("disabled");

    el.focus();
    setNativeValue(el, "");
    el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true }));

    const result = await chrome.runtime
      .sendMessage({ type: "TRUSTED_TYPE", text: String(value) })
      .catch((err) => ({ success: false, error: err.message }));

    if (!result?.success) {
      console.warn("[GeM Bill Auto-Submit] Trusted type nahi hua, synthetic char-by-char pe fallback kar raha hu:", result?.error);
      if (wasDisabled) el.setAttribute("disabled", "disabled");
      return await typeCharByCharById(id, value);
    }

    // CDP's Input.insertText resolves once Chrome's accepted the command,
    // not once the page's own renderer has actually applied it to the DOM -
    // reading el.value immediately after can still see the old (empty)
    // value for a beat, which was making the Product Details poll loop
    // think this attempt failed and fire off ANOTHER full debugger
    // attach/detach round trip (each one has real overhead), sometimes
    // several times in a row before catching up - the visible "Preview
    // takes forever" symptom. This gives the DOM a moment to settle first.
    await sleep(400);

    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    if (wasDisabled) el.setAttribute("disabled", "disabled");
    return el.value === String(value);
  }

  async function trustedTypeIntoFieldWithRetry(id, value, timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (document.getElementById(id)) {
        return await trustedTypeIntoField(id, value);
      }
      await sleep(300);
    }
    console.warn(`[GeM Bill Auto-Submit] #${id} never appeared to type "${value}" into after ${timeoutMs}ms.`);
    return false;
  }

  // Synthetic char-by-char fallback for when chrome.debugger can't attach.
  // Kept as-is from the earlier attempt - see trustedTypeIntoField above for
  // why it alone wasn't enough for HSN Code.
  async function typeCharByCharById(id, value) {
    const el = document.getElementById(id);
    if (!el) return false;

    const wasDisabled = el.disabled;
    if (wasDisabled) el.removeAttribute("disabled");

    el.focus();
    setNativeValue(el, "");
    el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true }));

    let current = "";
    for (const ch of String(value)) {
      current += ch;
      el.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true, cancelable: true }));
      setNativeValue(el, current);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, data: ch, inputType: "insertText" }));
      el.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true, cancelable: true }));
      await sleep(60);
    }

    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    if (wasDisabled) el.setAttribute("disabled", "disabled");
    return el.value === String(value);
  }

  async function typeCharByCharByIdWithRetry(id, value, timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (document.getElementById(id)) {
        return await typeCharByCharById(id, value);
      }
      await sleep(300);
    }
    console.warn(`[GeM Bill Auto-Submit] #${id} never appeared to type "${value}" into after ${timeoutMs}ms.`);
    return false;
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

  // Retries getPendingQtyFromPage - this text is rendered by GeM's own
  // Angular code shortly after the Product Details tab switch, so a single
  // immediate read right when stepProductDetails starts can come back null.
  async function getPendingQtyFromPageWithRetry(timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const qty = getPendingQtyFromPage();
      if (qty) return qty;
      await sleep(300);
    }
    console.warn(`[GeM Bill Auto-Submit] "Pending items to ship" text never appeared after ${timeoutMs}ms.`);
    return null;
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

  // The catalog edit page (Rate/Stock/Min Qty) has its own Captcha right
  // before the final Save/Submit - confirmed live 27-Aug-2026, separate from
  // the #captcha_math one on the login page. Its exact id isn't known yet
  // (unverified against the live page), so this looks for ANY visible text
  // input whose id/name/placeholder/nearby text mentions "captcha", the same
  // broad way setLabeledInputValue finds fields by nearby label text. If
  // found, waits for a human to type it in (like the login captcha) before
  // the caller clicks Save/Submit; if genuinely absent, resolves immediately
  // so pages without a captcha aren't blocked. omsOrigin (optional) also
  // pushes a visible banner onto the OMS tab itself, not just a console.log
  // here that's easy to miss while watching the GeM tab.
  async function waitForCaptchaIfPresent(omsOrigin) {
    // Confirmed live 19-Sep-2026 via DevTools (actual outerHTML, not a
    // screenshot guess) - this whole widget is a custom Angular directive
    // with a STABLE outer container id, unlike the <img>/<input> inside it:
    //   <show-captcha entered-captcha="catSvc.data.captcha" ...>
    //     <div id="simple_captcha">
    //       <div class="simple_captcha_image">
    //         <img alt="simple_captcha.jpg" ng-src="https://admin-mkp.gem.gov.in/simple_captcha/simple_captcha?...">
    //         <i class="fa fa-refresh" ng-click="createCaptchaUrl()"></i>
    //       </div>
    //       <div class="simple_captcha_field">
    //         <input type="text" id="captcha-text" ng-model="enteredCaptcha" ...>
    //       </div>
    //       <div class="simple_captcha_label">...</div>
    //     </div>
    //   </show-captcha>
    // Two earlier attempts to find the image/input WITHOUT this container -
    // matching the image's src/alt for "captcha", then matching a nearby
    // caption's text - both failed to find anything at all live (no
    // "Captcha OCR..." log of any kind, meaning the lookup itself returned
    // null before ever reaching a fetch). #simple_captcha is a plain,
    // directly-set id that isn't part of whatever Angular regenerates when
    // the confirm-checkbox below is ticked, so anchoring on it instead of
    // its contents should survive that regeneration too.
    const findCaptchaContainer = () => document.getElementById("simple_captcha");

    const findCaptchaImageAnywhere = () => {
      const container = findCaptchaContainer();
      if (!container) return null;
      const img = container.querySelector("img");
      return img && isVisible(img) && img.complete && img.naturalWidth > 0 ? img : null;
    };

    // The ONLY lookup ever trusted to WRITE into (OCR-fill below) - typing
    // an OCR'd answer into a wrongly-matched element is destructive (it
    // silently overwrites whatever real field that was), unlike the broad
    // fallback further down which is only ever used to READ a value while
    // polling - worst case there is waiting on the wrong field forever,
    // never corrupting one.
    const findCaptchaInputStrict = () => {
      const container = findCaptchaContainer();
      if (!container) return null;
      const input = container.querySelector('input[type="text"], input:not([type])');
      return input && isVisible(input) ? input : null;
    };

    const findCaptchaInput = () => {
      const strict = findCaptchaInputStrict();
      if (strict) return strict;

      // Old broad fallback - confirmed live 19-Sep-2026 to sometimes match
      // Current Stock or Minimum Quantity Per Consignee INSTEAD of the real
      // captcha box, because they share a form ancestor whose combined text
      // also happens to mention "captcha" somewhere below. Kept only for the
      // read-only polling wait at the bottom of this function - never used
      // for the OCR-fill above, which only ever calls findCaptchaInputStrict
      // directly for exactly this reason.
      return Array.from(document.querySelectorAll('input[type="text"], input:not([type])')).find((inp) => {
        if (!isVisible(inp)) return false;
        const id = (inp.id || "").toLowerCase();
        const name = (inp.name || "").toLowerCase();
        const placeholder = (inp.placeholder || "").toLowerCase();
        if (/captcha/.test(id) || /captcha/.test(name) || /captcha/.test(placeholder)) return true;
        const container = inp.closest("div, td, li, form") || inp.parentElement;
        return !!(container && /captcha/i.test(container.textContent || ""));
      });
    };

    // Waits for the STABLE CONTAINER specifically first (not the broad
    // fallback below) - confirmed live 19-Sep-2026 that <show-captcha>/
    // #simple_captcha is an ng-if in GeM's Angular code (catSvc.data.mode
    // === 'stock_edit'), which REMOVES the element from the DOM entirely
    // rather than merely hiding it while that condition is false. That
    // transition can take noticeably longer than a brief settle delay after
    // the confirm-checkbox click above - checking too soon (or falling
    // straight through to the broad fallback, which can match a
    // plausible-looking but WRONG input elsewhere in the form while the
    // real captcha section still doesn't exist yet) silently skipped
    // captcha-handling entirely and let the caller click Save/Update with
    // the field still empty ("Please enter captcha").
    const container = await waitForElementMatching(findCaptchaContainer, 15000).catch(() => null);

    // Old broad fallback used only if the container itself never showed up
    // at all within that time - i.e. this run genuinely has no captcha (or
    // GeM changed this page's structure again). See its own comment above
    // for why it's never trusted to WRITE into.
    const captchaInput = container
      ? Array.from(container.querySelectorAll('input[type="text"], input:not([type])')).find(isVisible)
      : await waitForElementMatching(() => findCaptchaInput(), 5000).catch(() => null);
    if (!captchaInput) return;

    console.log("[GeM Bill Auto-Submit] Is page par bhi Captcha hai - OCR se read karne ki koshish kar raha hu, nahi bana to manually bhar do (bharte hi Save/Submit apne aap ho jayega).");
    if (omsOrigin) {
      chrome.runtime
        .sendMessage({ type: "NOTIFY_OMS", omsOrigin, text: "⚠️ GeM tab me Captcha hai - OCR se bharne ki koshish ho rahi hai, agar na bhare to manually bhar do." })
        .catch(() => {}); // OMS tab not open, or messaging failed - not fatal, GeM tab itself is still usable
    }

    // Waits (via POLLING, not waitForElementMatching's MutationObserver -
    // see waitForCondition's own comment for why) for the image to actually
    // finish LOADING (img.complete && naturalWidth > 0), not just for it to
    // exist in the DOM. Confirmed live 19-Sep-2026 that the container+img+
    // input were all genuinely present exactly as expected (verified
    // directly in the Elements panel) yet findCaptchaImageAnywhere() still
    // returned null right after a flat 600ms delay - GeM's
    // <i class="fa fa-refresh" ng-click="createCaptchaUrl()"> sets a fresh
    // ng-src whenever the captcha regenerates (confirmed live 01-Sep-2026
    // that ticking the confirm-checkbox above triggers exactly that
    // regeneration), and while that new image is still downloading from
    // GeM's own server, .complete is false and .naturalWidth is 0 - a flat
    // delay (or a mutation-based wait, since the load finishing isn't a DOM
    // mutation) can easily lose that race on a slow load.
    const captchaImg = await waitForCondition(findCaptchaImageAnywhere, 8000).catch(() => null);

    // Fire-and-forget, same reasoning as the login page's OCR (ocrCaptcha
    // above) - a slow OCR round-trip shouldn't block a human who's already
    // typing.
    //
    // Uses simulateTyping, NOT setNativeValue+fireEvents - this is the same
    // AngularJS ng-model-bound input as Rate/Stock/Min Qty (confirmed live
    // 01-Sep-2026, see simulateTyping's own comment above), which only
    // registers a change via real per-character keyboard events.
    if (captchaImg) {
      ocrCaptchaFromImage(captchaImg, omsOrigin).then((text) => {
        if (!text) return;
        const liveInput = findCaptchaInputStrict(); // strict re-find right before typing - see note above
        if (!liveInput) return;
        console.log("[GeM Bill Auto-Submit] Is page ka Captcha OCR se read kar liya:", text);
        simulateTyping(liveInput, text);
      });
    } else {
      console.warn("[GeM Bill Auto-Submit] Captcha image nahi mili OCR ke liye - manually bhar do.");
    }

    // Polls the LIVE DOM (re-finds the captcha input fresh every tick)
    // instead of listening on one captured node - confirmed live 01-Sep-2026
    // that GeM regenerates this captcha (new image + a NEW input element)
    // when the confirm-checkbox above gets ticked, which silently detaches
    // a single-node listener and left this waiting forever even after the
    // user typed into the replacement box.
    //
    // Threshold is exactly 6, not "looks long enough" - this catalog-edit
    // captcha is consistently 6 characters (confirmed live across several
    // runs: SMLYNV, CDQIOY, KWEQMK, WGITEW, RODOLB). A looser >=3 threshold
    // fired Save/Submit the moment the user was only half-done typing,
    // submitting a truncated/wrong captcha.
    const CAPTCHA_LENGTH = 6;
    await new Promise((resolve) => {
      const intervalId = setInterval(() => {
        const el = findCaptchaInput();
        if (el && el.value.trim().length >= CAPTCHA_LENGTH) {
          clearInterval(intervalId);
          resolve();
        }
      }, 400);
    });
  }

  // The "reload captcha and try again" refresh control - <i class="fa
  // fa-refresh" ng-click="createCaptchaUrl()"> sitting next to the image
  // inside #simple_captcha (confirmed live 19-Sep-2026 via DevTools, see
  // waitForCaptchaIfPresent's own HTML comment for the full structure).
  function clickCaptchaRefreshIfPresent() {
    const container = document.getElementById("simple_captcha");
    const refreshBtn = container && container.querySelector('.fa-refresh, [ng-click*="createCaptchaUrl"]');
    if (refreshBtn) refreshBtn.click();
    return !!refreshBtn;
  }

  // Wraps waitForCaptchaIfPresent + a Save/Update click in a retry loop -
  // OCR's answer is sometimes just wrong (character confusions like I/1,
  // O/0 are a known OCR failure mode, human or automated) and GeM's own
  // response to that is a fresh captcha needing another attempt, not a dead
  // end (confirmed live 19-Sep-2026: "Invalid Captcha"). Also covers
  // waitForCaptchaIfPresent's other confirmed-live case, the widget not
  // existing in the DOM at all until this button is clicked once ("Please
  // enter captcha") - both surface through the same retry here. Bounded to
  // maxAttempts so a captcha OCR keeps getting wrong on doesn't loop
  // forever; the outer pendingCatalogueUpdate's own 15-minute staleness
  // timeout is the hard backstop regardless.
  // Returns true once Save/Update goes through cleanly, false if maxAttempts
  // are exhausted without that - callers use this to decide whether the item
  // actually succeeded (MARK_CHECKLIST_SYNCED) or needs to be recorded as
  // failed (MARK_CHECKLIST_SYNC_FAILED) rather than assuming success just
  // because this function returned at all.
  async function saveWithCaptchaRetry(omsOrigin, saveButtonRegex, maxAttempts = 3) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await waitForCaptchaIfPresent(omsOrigin);
      // trustedClickButtonByText, NOT clickButtonByText - see its own
      // comment for why a plain .click() silently does nothing on this
      // button (confirmed live 19-Sep-2026: captcha filled correctly, no
      // error shown, button just never reacted).
      await trustedClickButtonByText(saveButtonRegex);
      await sleep(1500);

      const captchaRejected = /invalid captcha|please enter captcha/i.test(document.body.textContent || "");
      if (!captchaRejected) return true; // succeeded, or this page never had a captcha to begin with

      if (attempt < maxAttempts) {
        console.log(`[GeM Bill Auto-Submit] Captcha galat ya khali tha (attempt ${attempt}/${maxAttempts}) - refresh karke dobara try kar raha hu.`);
        clickCaptchaRefreshIfPresent();
        await sleep(800); // let GeM swap in the fresh image before the next waitForCaptchaIfPresent runs

        // Clears whatever wrong answer is still sitting in the box from this
        // attempt - otherwise waitForCaptchaIfPresent's own "wait until 6
        // characters are typed" polling loop on the next attempt would see
        // that STALE (already-known-wrong) value and resolve immediately,
        // resubmitting it again instead of waiting for the fresh OCR read.
        const container = document.getElementById("simple_captcha");
        const staleInput = container && container.querySelector('input[type="text"], input:not([type])');
        if (staleInput) setNativeValue(staleInput, "");
      } else {
        console.warn(`[GeM Bill Auto-Submit] Captcha ${maxAttempts} baar try karne ke baad bhi sahi nahi bana - manually complete karo.`);
        return false;
      }
    }
    return false;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Polls checkFn on an interval until it returns a truthy value, instead of
  // waiting for a DOM mutation like waitForElementMatching does - needed for
  // conditions that change WITHOUT any DOM mutation firing at all, such as
  // an already-present <img> finishing its own async load (img.complete /
  // naturalWidth flip once the browser finishes downloading it - that's an
  // internal resource-loading state change, not a DOM tree/attribute
  // mutation, so a MutationObserver-based wait never re-checks it and just
  // times out unhelpfully instead).
  function waitForCondition(checkFn, timeoutMs, intervalMs = 300) {
    return new Promise((resolve, reject) => {
      const immediate = checkFn();
      if (immediate) return resolve(immediate);

      const intervalId = setInterval(() => {
        const result = checkFn();
        if (result) {
          clearInterval(intervalId);
          clearTimeout(timeoutId);
          resolve(result);
        }
      }, intervalMs);

      const timeoutId = setTimeout(() => {
        clearInterval(intervalId);
        reject(new Error(`Condition not met within ${timeoutMs}ms.`));
      }, timeoutMs);
    });
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
})();
