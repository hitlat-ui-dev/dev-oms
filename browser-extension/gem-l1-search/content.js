/*
 * Runs on mkp.gem.gov.in (the buyer-facing GeM Marketplace search, not the
 * bidplus tender site another extension in this repo already covers).
 *
 * Category search itself is not automated here - the popup just navigates
 * the tab straight to whatever category search URL the user pastes in
 * (e.g. https://mkp.gem.gov.in/hand-tools-.../search), since that's how
 * GeM's own category search actually resolves and it's far more reliable
 * than guessing at a search-box's DOM shape.
 *
 * Honesty note, same as this repo's other GeM extensions: parts of this
 * (the Golden Parameter scanning/golden-icon detection, product card
 * scraping) were refined against a real screenshot of a live results page,
 * but never against the live DOM itself - no network access to
 * mkp.gem.gov.in from where this was built. Selectors are heuristic, not
 * hardcoded ids. Use the popup's "Diagnose Page" button to see exactly
 * what the page-scanning code found (including, per spec heading, whether
 * it was flagged as golden) - share that output to get the matchers
 * corrected quickly, the same way the Consignee State/City selectors in
 * this repo's other GeM Bid Exporter tool got fixed after the first guess
 * turned out wrong.
 */
(function () {
  "use strict";

  const STATUS_KEY = "gemL1Status";
  const RESULTS_KEY = "gemL1Results";
  const CANCEL_KEY = "gemL1Cancel";

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function setStatus(status) {
    const data = await chrome.storage.local.get(STATUS_KEY);
    const prev = data[STATUS_KEY] || {};
    await chrome.storage.local.set({ [STATUS_KEY]: { ...prev, ...status } });
  }

  async function isCancelled() {
    const data = await chrome.storage.local.get(CANCEL_KEY);
    return !!data[CANCEL_KEY];
  }

  function setInputValue(el, value) {
    const proto = window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ---------------------------------------------------------------------
  // Product listing cards. Category search itself is NOT automated here -
  // GeM's search redirects to a category-specific URL
  // (e.g. https://mkp.gem.gov.in/hand-tools-.../search) rather than a
  // simple type-and-submit search box, so the popup just navigates the tab
  // straight to whatever category URL the user pastes in.
  // ---------------------------------------------------------------------

  function findProductCards() {
    const priceRe = /₹\s?[\d,]+(?:\.\d+)?/;
    const anchors = Array.from(document.querySelectorAll("a[href]")).filter((a) => {
      const href = a.getAttribute("href") || "";
      const text = (a.textContent || "").trim();
      return /product|item|catalog|dynamicdesc/i.test(href) && text.length > 3;
    });
    const cards = [];
    const seenContainers = new Set();
    for (const a of anchors) {
      let el = a;
      let container = null;
      for (let depth = 0; depth < 8 && el; depth++) {
        el = el.parentElement;
        if (!el) break;
        const txt = el.innerText || "";
        const matches = txt.match(new RegExp(priceRe.source, "g")) || [];
        if (matches.length === 1) container = el;
        else if (matches.length > 1 && container) break; // climbed past the card into the results list
      }
      if (!container || seenContainers.has(container)) continue;
      seenContainers.add(container);
      const text = container.innerText || "";
      const priceMatch = text.match(priceRe);
      const sellerMatch = text.match(/(?:sold by|seller)\s*[:\-]?\s*([^\n]+)/i);
      cards.push({
        title: (a.textContent || "").replace(/\s+/g, " ").trim(),
        link: a.href,
        price: priceMatch ? priceMatch[0].replace(/[₹,\s]/g, "") : "",
        priceText: priceMatch ? priceMatch[0] : "",
        seller: sellerMatch ? sellerMatch[1].trim() : "",
      });
    }
    return cards;
  }

  // ---------------------------------------------------------------------
  // "Golden Parameters" - on GeM's own search-results filter panel, these
  // are the specific technical-specification filters (under "Product
  // Specifications", itself under "Make/Model Selection") that GeM marks
  // with a small golden/amber info icon - NOT every filter in that section,
  // and definitely not the other top-level filter groups (Make In India,
  // MSE, Seller Rating, Financial, etc.) which are ignored entirely here.
  //
  // Two things this scanning has to work around, seen directly in a real
  // screenshot of the page:
  //  1. Each spec (e.g. "Calibration Certificate Provided By Supplier") is
  //     its own collapsible row - most start collapsed, so their checkbox
  //     options ("Any Value"/"No"/"Yes") aren't scanned until that row is
  //     expanded. expandAllWithin() below clicks every closed
  //     [aria-expanded="false"] toggle inside the section first.
  //  2. Only SOME specs carry the golden icon (in the screenshot,
  //     "Calibration Certificate Provided By Supplier" has it, "Number Of
  //     Arms" and "ISO 9001 Certified" don't). hasGoldenMarkerNear() flags
  //     this by checking for a small icon near the heading whose color is
  //     golden/amber, or whose title/aria-label/alt/class mentions
  //     "golden"/"mandatory" - a color-based heuristic since the exact
  //     class name behind that icon has never been seen (no access to the
  //     live DOM while building this). If it misses or over-flags a spec,
  //     "Diagnose Page" now dumps every spec heading found here plus
  //     whether it was flagged golden - share that output to get the
  //     color thresholds in isGoldenColor() corrected.
  // ---------------------------------------------------------------------

  function findSectionByHeadingText(re) {
    const leafEls = Array.from(document.querySelectorAll("body *")).filter((el) => el.children.length === 0);
    const headingEl = leafEls.find((el) => {
      const t = (el.textContent || "").trim();
      return t && t.length < 60 && re.test(t);
    });
    if (!headingEl) return null;
    let container = headingEl.parentElement;
    for (let i = 0; i < 6 && container; i++) {
      const cbCount = container.querySelectorAll('input[type="checkbox"]').length;
      const expandableCount = container.querySelectorAll("[aria-expanded]").length;
      if (cbCount > 0 || expandableCount > 1) return container;
      container = container.parentElement;
    }
    return headingEl.parentElement || headingEl;
  }

  async function expandAllWithin(container) {
    if (!container) return 0;
    let expandedCount = 0;
    for (let pass = 0; pass < 3; pass++) {
      const collapsed = Array.from(container.querySelectorAll('[aria-expanded="false"]'));
      if (!collapsed.length) break;
      for (const el of collapsed) {
        el.click();
        expandedCount++;
        await sleep(120);
      }
      await sleep(200);
    }
    return expandedCount;
  }

  function parseRgb(str) {
    const m = (str || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3] };
  }

  // Amber/gold/orange-ish: red clearly ahead of blue, green present but not
  // dominant. Tuned against a typical "warning/info" amber icon color -
  // adjust these thresholds from Diagnose Page's reported RGB values if a
  // real golden icon isn't being matched.
  function isGoldenColor(str) {
    const c = parseRgb(str);
    if (!c) return false;
    return c.r > 140 && c.g > 80 && c.b < 130 && c.r - c.b > 40 && c.g - c.b > 10;
  }

  function hasGoldenMarkerNear(headingEl) {
    const scope = headingEl.closest("div") || headingEl.parentElement || headingEl;
    const icons = Array.from(scope.querySelectorAll("i, svg, span, img, path")).slice(0, 15);
    for (const el of icons) {
      let cs;
      try {
        cs = window.getComputedStyle(el);
      } catch (e) {
        continue;
      }
      if (isGoldenColor(cs.color) || isGoldenColor(cs.backgroundColor) || isGoldenColor(cs.fill)) return true;
      const hint = `${el.getAttribute("title") || ""} ${el.getAttribute("aria-label") || ""} ${el.getAttribute("alt") || ""} ${el.className || ""}`.toLowerCase();
      if (/golden|mandatory|key\s*param/.test(hint)) return true;
    }
    return false;
  }

  function checkboxLabel(cb) {
    let label = "";
    if (cb.id) {
      const l = document.querySelector(`label[for="${CSS.escape(cb.id)}"]`);
      if (l) label = l.textContent || "";
    }
    if (!label) {
      const parentLabel = cb.closest("label");
      if (parentLabel) label = parentLabel.textContent || "";
    }
    if (!label && cb.nextElementSibling) label = cb.nextElementSibling.textContent || "";
    if (!label && cb.parentElement) label = cb.parentElement.textContent || "";
    return label.replace(/\s+/g, " ").trim();
  }

  function checkboxHeading(cb) {
    const HEADING_SEL = "h1,h2,h3,h4,h5,h6,legend,.filter-title,.title,.filter-heading";
    let container = cb.closest("li") || cb.closest("div") || cb.parentElement;
    let walker = container;
    for (let depth = 0; depth < 10 && walker; depth++) {
      const prev = walker.previousElementSibling;
      if (prev && HEADING_SEL.split(",").some((sel) => prev.matches && prev.matches(sel))) {
        const t = (prev.textContent || "").trim();
        if (t) return t;
      }
      const parent = walker.parentElement;
      if (parent) {
        const headingEl = Array.from(parent.children).find(
          (c) => c !== walker && HEADING_SEL.split(",").some((sel) => c.matches && c.matches(sel))
        );
        if (headingEl) {
          const t = (headingEl.textContent || "").trim();
          if (t) return t;
        }
      }
      walker = walker.parentElement;
    }
    return "";
  }

  // Scans checkboxes ONLY inside the given container (the Product
  // Specifications section), groups them by heading, and flags which
  // headings carry the golden marker. Returns live element refs - internal
  // use only (setCheckboxState below); see loadGoldenParameters() for the
  // serializable version sent to the popup.
  function scanSpecGroupsWithEls(container) {
    if (!container) return [];
    const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]'));
    const groups = new Map();
    for (const cb of checkboxes) {
      const label = checkboxLabel(cb);
      if (!label) continue;
      const heading = checkboxHeading(cb) || "Other Specification";
      if (!groups.has(heading)) groups.set(heading, { golden: false, options: [] });
      groups.get(heading).options.push({ label, checked: cb.checked, el: cb });
    }
    const leafEls = Array.from(container.querySelectorAll("*")).filter((el) => el.children.length === 0);
    for (const [name, g] of groups) {
      const headingEl = leafEls.find((el) => (el.textContent || "").trim() === name);
      if (headingEl && hasGoldenMarkerNear(headingEl)) g.golden = true;
    }
    return Array.from(groups.entries()).map(([name, g]) => ({ name, golden: g.golden, options: g.options }));
  }

  async function loadGoldenParameters() {
    const container = findSectionByHeadingText(/product specifications/i);
    if (!container) return { ok: false, error: "product_specifications_section_not_found" };
    await expandAllWithin(container);
    await sleep(300);
    const groups = scanSpecGroupsWithEls(container);
    return {
      ok: true,
      groups: groups.map((g) => ({ name: g.name, golden: g.golden, options: g.options.map((o) => ({ label: o.label, checked: o.checked })) })),
    };
  }

  function setCheckboxState(groupName, optionLabel, checked) {
    const container = findSectionByHeadingText(/product specifications/i);
    const groups = scanSpecGroupsWithEls(container);
    const group = groups.find((g) => g.name === groupName);
    if (!group) return false;
    const opt = group.options.find((o) => o.label === optionLabel);
    if (!opt) return false;
    if (!!opt.el.checked !== !!checked) opt.el.click();
    return true;
  }

  // ---------------------------------------------------------------------
  // Delivery pincode / quantity - best-effort. GeM's per-product landed
  // price (freight-adjusted) is often only shown once a pincode + quantity
  // is entered, sometimes on the product detail page rather than the
  // search-results list. This sets whatever matching fields it can find on
  // the CURRENT page; if nothing matches, it's a no-op (surfaced back to
  // the popup as pincodeSet/qtySet: false) rather than a thrown error.
  // ---------------------------------------------------------------------

  function findFieldByKeyword(re, types) {
    const inputs = Array.from(document.querySelectorAll((types || ["text", "number", "tel", "search"]).map((t) => `input[type="${t}"]`).join(", ")));
    return (
      inputs.find((el) => re.test(el.placeholder || "")) ||
      inputs.find((el) => re.test((el.id || "") + " " + (el.name || "") + " " + (el.getAttribute("aria-label") || ""))) ||
      null
    );
  }

  async function setDeliveryContext(pincode, qty) {
    let pincodeSet = false;
    let qtySet = false;
    if (pincode) {
      const el = findFieldByKeyword(/pin\s*code|pincode/i, ["text", "number", "tel"]);
      if (el) {
        setInputValue(el, String(pincode));
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
        pincodeSet = true;
        await sleep(800);
      }
    }
    if (qty) {
      const el = findFieldByKeyword(/qty|quantity/i, ["number", "text"]);
      if (el) {
        setInputValue(el, String(qty));
        qtySet = true;
      }
    }
    return { ok: true, pincodeSet, qtySet };
  }

  // ---------------------------------------------------------------------
  // Smart combination search: fixes the "required" Golden Parameters,
  // tries every combination of the "free" ones (bounded by maxCombos), and
  // - per the requested workflow - keeps whichever combination returns the
  // MOST matching listings (so the eventual L1-L4 ranking is a real
  // competitive set, not a single leftover SKU with 0-1 sellers). That
  // winning set is then sorted by price ascending and the cheapest four
  // become L1/L2/L3/L4.
  // ---------------------------------------------------------------------

  function cartesianProduct(freeGroups) {
    let result = [[]];
    for (const g of freeGroups) {
      if (!g.options || !g.options.length) continue;
      const next = [];
      for (const combo of result) {
        for (const opt of g.options) next.push([...combo, { group: g.name, option: opt }]);
      }
      result = next;
    }
    return result;
  }

  function rankAndSave(cards, comboLabel, meta) {
    const ranked = cards
      .filter((c) => c.price)
      .sort((a, b) => parseFloat(a.price) - parseFloat(b.price))
      .slice(0, 4)
      .map((c, i) => ({
        rank: "L" + (i + 1),
        title: c.title,
        priceText: c.priceText,
        price: c.price,
        seller: c.seller,
        link: c.link,
        matchedParameters: comboLabel,
        ...meta,
      }));
    return chrome.storage.local.set({ [RESULTS_KEY]: ranked }).then(() => ranked);
  }

  async function runCombinationSearch({ required, freeGroups, maxCombos, category, pincode, qty }) {
    await chrome.storage.local.set({ [CANCEL_KEY]: false });
    const combos = cartesianProduct(freeGroups || []).slice(0, Math.max(1, maxCombos || 20));
    await setStatus({ running: true, phase: "applying required filters…", combosTried: 0, combosTotal: combos.length || 1 });

    for (const r of required || []) setCheckboxState(r.group, r.option, true);
    await sleep(1000);

    let best = null; // { combo, cards }
    const loopCombos = combos.length ? combos : [[]];

    for (let i = 0; i < loopCombos.length; i++) {
      if (await isCancelled()) {
        await setStatus({ running: false, phase: "cancelled" });
        return;
      }
      const combo = loopCombos[i];
      for (const r of required || []) setCheckboxState(r.group, r.option, true);
      for (const g of freeGroups || []) {
        for (const opt of g.options) setCheckboxState(g.name, opt, false);
      }
      for (const c of combo) setCheckboxState(c.group, c.option, true);

      await sleep(1200); // let the results panel re-render/AJAX settle
      const cards = findProductCards();
      const comboDesc = combo.map((c) => `${c.group}: ${c.option}`).join(", ") || "(no free parameters varied)";
      await setStatus({
        running: true,
        phase: `combo ${i + 1}/${loopCombos.length} — ${cards.length} listing(s) — ${comboDesc}`,
        combosTried: i + 1,
        combosTotal: loopCombos.length,
      });

      if (cards.length && (!best || cards.length > best.cards.length)) best = { combo, cards };
    }

    if (!best) {
      await setStatus({ running: false, phase: "no combination returned any listings - widen the free parameter options or check Diagnose Page" });
      return;
    }

    const comboLabel =
      (required || []).map((r) => `${r.group}: ${r.option}`).concat(best.combo.map((c) => `${c.group}: ${c.option}`)).join(", ") ||
      "(default, no filters)";
    const ranked = await rankAndSave(best.cards, comboLabel, { category: category || "", pincode: pincode || "", qty: qty || "" });
    await setStatus({
      running: false,
      phase: `done — best combination had ${best.cards.length} listing(s) across ${loopCombos.length} tried; saved top ${ranked.length}`,
    });
  }

  // ---------------------------------------------------------------------
  // Diagnose Page - dumps everything the scanning code can currently see,
  // so mismatches against the real GeM DOM can be fixed quickly.
  // ---------------------------------------------------------------------

  async function diagnosePage() {
    const container = findSectionByHeadingText(/product specifications/i);
    let specSection;
    if (!container) {
      specSection = { found: false };
    } else {
      await expandAllWithin(container);
      await sleep(300);
      const groups = scanSpecGroupsWithEls(container);
      specSection = {
        found: true,
        groupCount: groups.length,
        groups: groups.map((g) => ({
          name: g.name,
          golden: g.golden,
          optionCount: g.options.length,
          options: g.options.slice(0, 6).map((o) => o.label),
        })),
      };
    }

    const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]')).map((cb, i) => ({
      index: i,
      id: cb.id || "",
      name: cb.name || "",
      label: checkboxLabel(cb),
      heading: checkboxHeading(cb),
      checked: cb.checked,
    }));
    const textInputs = Array.from(document.querySelectorAll('input[type="text"], input[type="search"], input[type="number"], input[type="tel"]')).map(
      (el, i) => ({
        index: i,
        type: el.type,
        id: el.id || "",
        name: el.name || "",
        placeholder: el.placeholder || "",
        ariaLabel: el.getAttribute("aria-label") || "",
      })
    );
    const cards = findProductCards();
    return {
      specSection,
      checkboxCount: checkboxes.length,
      checkboxes: checkboxes.slice(0, 60),
      textInputCount: textInputs.length,
      textInputs: textInputs.slice(0, 30),
      productCardCount: cards.length,
      sampleCards: cards.slice(0, 5),
    };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "PING") {
      sendResponse({ ok: true });
      return;
    }

    if (msg.action === "LOAD_GOLDEN_PARAMETERS") {
      (async () => {
        try {
          sendResponse(await loadGoldenParameters());
        } catch (e) {
          sendResponse({ ok: false, error: "exception: " + String((e && e.message) || e) });
        }
      })();
      return true;
    }

    if (msg.action === "SCRAPE_CURRENT_LISTINGS") {
      try {
        sendResponse({ ok: true, cards: findProductCards() });
      } catch (e) {
        sendResponse({ ok: false, error: "exception: " + String((e && e.message) || e) });
      }
      return;
    }

    if (msg.action === "SET_DELIVERY_CONTEXT") {
      (async () => {
        try {
          sendResponse(await setDeliveryContext(msg.pincode, msg.qty));
        } catch (e) {
          sendResponse({ ok: false, error: "exception: " + String((e && e.message) || e) });
        }
      })();
      return true;
    }

    if (msg.action === "RUN_COMBINATION_SEARCH") {
      (async () => {
        await runCombinationSearch(msg);
      })();
      sendResponse({ ok: true, started: true });
      return;
    }

    if (msg.action === "CANCEL_COMBINATION_SEARCH") {
      (async () => {
        await chrome.storage.local.set({ [CANCEL_KEY]: true });
      })();
      sendResponse({ ok: true });
      return;
    }

    if (msg.action === "DIAGNOSE_PAGE") {
      (async () => {
        try {
          sendResponse({ ok: true, ...(await diagnosePage()) });
        } catch (e) {
          sendResponse({ ok: false, error: "exception: " + String((e && e.message) || e) });
        }
      })();
      return true;
    }
  });
})();
