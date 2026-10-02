(function () {
  "use strict";

  const STATUS_KEY = "gemL1Status";
  const RESULTS_KEY = "gemL1Results";
  const CANCEL_KEY = "gemL1Cancel";
  const PARAMS_UI_KEY = "gemL1ParamsUI"; // { groups, selections } - survives popup close/reopen
  const GEM_URL = "https://mkp.gem.gov.in/";

  const EXPORT_HEADERS = ["Rank", "Price", "Product Title", "Seller", "Product Link", "Matched Golden Parameters", "Category", "Pincode", "Qty"];

  const scanStateEl = document.getElementById("scanState");
  const statusEl = document.getElementById("status");
  const categoryUrlInputEl = document.getElementById("categoryUrlInput");
  const btnSearch = document.getElementById("btnSearch");
  const btnLoadParams = document.getElementById("btnLoadParams");
  const paramsContainerEl = document.getElementById("paramsContainer");
  const pincodeInputEl = document.getElementById("pincodeInput");
  const qtyInputEl = document.getElementById("qtyInput");
  const btnApplyDelivery = document.getElementById("btnApplyDelivery");
  const maxCombosEl = document.getElementById("maxCombos");
  const btnQuickScan = document.getElementById("btnQuickScan");
  const btnRunSmart = document.getElementById("btnRunSmart");
  const btnCancel = document.getElementById("btnCancel");
  const resultsTableEl = document.getElementById("resultsTable");
  const resultsBodyEl = document.getElementById("resultsBody");
  const resultsHintEl = document.getElementById("resultsHint");
  const btnExport = document.getElementById("btnExport");
  const btnDiagnose = document.getElementById("btnDiagnose");
  const debugOutputEl = document.getElementById("debugOutput");
  const btnClear = document.getElementById("btnClear");

  const ALL_BUTTONS = [btnSearch, btnLoadParams, btnApplyDelivery, btnQuickScan, btnRunSmart, btnExport, btnDiagnose, btnClear];

  function setBusy(busy) {
    ALL_BUTTONS.forEach((b) => (b.disabled = busy));
  }

  let state = { groups: [], selections: {} };

  function sanitizeKey(s) {
    return (s || "").replace(/[^a-zA-Z0-9]/g, "_");
  }

  // "https://mkp.gem.gov.in/hand-tools-measuring-and-layout-tools-universal-bevel-protractor/search"
  // -> "hand tools measuring and layout tools universal bevel protractor" - just for a readable
  // Category column in the export; falls back to the raw URL if the path doesn't look like GeM's shape.
  function categoryLabelFromUrl(url) {
    try {
      const path = new URL(url).pathname.replace(/^\/+|\/+$/g, "");
      const slug = path.replace(/\/search$/i, "");
      return slug ? slug.replace(/-/g, " ") : url;
    } catch (e) {
      return url || "";
    }
  }

  async function saveParamsUI() {
    await chrome.storage.local.set({ [PARAMS_UI_KEY]: state });
  }

  async function loadParamsUI() {
    const data = await chrome.storage.local.get(PARAMS_UI_KEY);
    if (data[PARAMS_UI_KEY]) {
      state = data[PARAMS_UI_KEY];
      renderParams();
    }
  }

  function ensureSelection(groupName) {
    if (!state.selections[groupName]) state.selections[groupName] = { mode: "ignore", chosen: {} };
    return state.selections[groupName];
  }

  function renderParams() {
    paramsContainerEl.innerHTML = "";
    if (!state.groups.length) {
      paramsContainerEl.innerHTML = '<div class="hint">No parameters loaded yet.</div>';
      return;
    }
    state.groups.forEach((group) => {
      const sel = ensureSelection(group.name);
      const gKey = sanitizeKey(group.name);

      const fs = document.createElement("fieldset");
      fs.className = "paramGroup";
      const legend = document.createElement("legend");
      legend.textContent = group.golden ? `🟡 GOLDEN — ${group.name}` : group.name;
      fs.appendChild(legend);

      const modeRow = document.createElement("div");
      modeRow.className = "modeRow";
      [
        ["ignore", "Ignore"],
        ["required", "Required (fix)"],
        ["free", "Auto-vary"],
      ].forEach(([val, text]) => {
        const lbl = document.createElement("label");
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "mode_" + gKey;
        radio.value = val;
        radio.checked = sel.mode === val;
        radio.addEventListener("change", () => {
          sel.mode = val;
          saveParamsUI();
          renderOptions();
        });
        lbl.appendChild(radio);
        lbl.appendChild(document.createTextNode(text));
        modeRow.appendChild(lbl);
      });
      fs.appendChild(modeRow);

      const optionsWrap = document.createElement("div");
      fs.appendChild(optionsWrap);

      function renderOptions() {
        optionsWrap.innerHTML = "";
        if (sel.mode === "ignore") return;
        group.options.forEach((opt) => {
          const row = document.createElement("div");
          row.className = "optionRow";
          const input = document.createElement("input");
          input.type = sel.mode === "required" ? "radio" : "checkbox";
          if (sel.mode === "required") input.name = "req_" + gKey;
          input.checked = !!sel.chosen[opt.label];
          input.addEventListener("change", () => {
            if (sel.mode === "required") sel.chosen = {};
            if (input.checked) sel.chosen[opt.label] = true;
            else delete sel.chosen[opt.label];
            saveParamsUI();
          });
          const lbl = document.createElement("label");
          lbl.textContent = opt.label;
          row.appendChild(input);
          row.appendChild(lbl);
          optionsWrap.appendChild(row);
        });
      }
      renderOptions();

      paramsContainerEl.appendChild(fs);
    });
  }

  function buildRequiredAndFree() {
    const required = [];
    const freeGroups = [];
    state.groups.forEach((group) => {
      const sel = state.selections[group.name];
      if (!sel) return;
      if (sel.mode === "required") {
        const chosen = Object.keys(sel.chosen);
        if (chosen.length) required.push({ group: group.name, option: chosen[0] });
      } else if (sel.mode === "free") {
        const chosen = Object.keys(sel.chosen);
        if (chosen.length) freeGroups.push({ name: group.name, options: chosen });
      }
    });
    return { required, freeGroups };
  }

  async function getOrOpenGemTab() {
    const existing = await chrome.tabs.query({ url: "https://mkp.gem.gov.in/*" });
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

  async function ensureContentScript(tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { action: "PING" });
      return true;
    } catch (e) {
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ["lib/xlsx-writer.js", "content.js"] });
        return true;
      } catch (e2) {
        statusEl.textContent = "Could not connect to the page. Reload the GeM tab and try again.";
        return false;
      }
    }
  }

  async function withGemTab(fn) {
    const tab = await getOrOpenGemTab();
    const ready = await ensureContentScript(tab.id);
    if (!ready) return null;
    return fn(tab);
  }

  async function refreshStatusUI() {
    const data = await chrome.storage.local.get([STATUS_KEY, RESULTS_KEY]);
    const status = data[STATUS_KEY] || null;
    const results = data[RESULTS_KEY] || [];

    if (status && status.running) {
      scanStateEl.textContent = "Running…";
      scanStateEl.className = "value warn";
      statusEl.textContent = status.phase || "Working…";
      setBusy(true);
    } else {
      scanStateEl.textContent = "Idle";
      scanStateEl.className = "value ok";
      statusEl.textContent = (status && status.phase) || "Ready.";
      setBusy(false);
    }

    if (results.length) {
      resultsTableEl.style.display = "table";
      resultsHintEl.style.display = "none";
      resultsBodyEl.innerHTML = "";
      results.forEach((r) => {
        const tr = document.createElement("tr");
        tr.innerHTML =
          `<td>${r.rank}</td><td>${r.priceText || r.price || ""}</td><td>${(r.title || "").slice(0, 40)}</td>` +
          `<td>${r.seller || ""}</td><td><a href="${r.link}" target="_blank" rel="noopener">open</a></td>`;
        resultsBodyEl.appendChild(tr);
      });
    } else {
      resultsTableEl.style.display = "none";
      resultsHintEl.style.display = "block";
      resultsHintEl.textContent = "No results yet.";
    }
  }

  btnSearch.addEventListener("click", async () => {
    const url = (categoryUrlInputEl.value || "").trim();
    if (!/^https:\/\/mkp\.gem\.gov\.in\//i.test(url)) {
      statusEl.textContent = "Paste a valid mkp.gem.gov.in category search URL first.";
      return;
    }
    setBusy(true);
    statusEl.textContent = "Opening the category page…";
    try {
      const existing = await chrome.tabs.query({ url: "https://mkp.gem.gov.in/*" });
      let tab;
      if (existing.length) {
        tab = existing.find((t) => t.active) || existing[0];
        await chrome.tabs.update(tab.id, { url, active: true });
      } else {
        tab = await chrome.tabs.create({ url, active: true });
      }
      await waitForTabComplete(tab.id, 20000);
      await ensureContentScript(tab.id);
      statusEl.textContent = "Category page loaded. Now click 'Load Golden Parameters From Page'.";
    } catch (e) {
      statusEl.textContent = "Could not open the category page. Check the URL and try again.";
    } finally {
      setBusy(false);
    }
  });

  btnLoadParams.addEventListener("click", async () => {
    setBusy(true);
    statusEl.textContent = "Reading Golden Parameters from the page…";
    try {
      await withGemTab(async (tab) => {
        const result = await chrome.tabs.sendMessage(tab.id, { action: "LOAD_GOLDEN_PARAMETERS" });
        if (result && result.ok) {
          // Preserve existing mode/chosen selections for groups that still exist by name.
          const prevSelections = state.selections || {};
          state = { groups: result.groups, selections: {} };
          result.groups.forEach((g) => {
            state.selections[g.name] = prevSelections[g.name] || { mode: "ignore", chosen: {} };
          });
          await saveParamsUI();
          renderParams();
          statusEl.textContent = result.groups.length
            ? `Loaded ${result.groups.length} parameter group(s). Set Required/Auto-vary/Ignore for each below.`
            : "No filter checkboxes found on this page. Try Diagnose Page to see what's there.";
        } else {
          statusEl.textContent = `Could not load parameters (${(result && result.error) || "unknown error"}).`;
        }
      });
    } catch (e) {
      statusEl.textContent = "Could not load parameters. Reload the GeM tab and try again.";
    } finally {
      setBusy(false);
    }
  });

  btnApplyDelivery.addEventListener("click", async () => {
    const pincode = (pincodeInputEl.value || "").trim();
    const qty = (qtyInputEl.value || "").trim();
    if (!pincode && !qty) {
      statusEl.textContent = "Enter a pincode and/or quantity first.";
      return;
    }
    setBusy(true);
    statusEl.textContent = "Applying pincode/quantity on the page…";
    try {
      await withGemTab(async (tab) => {
        const result = await chrome.tabs.sendMessage(tab.id, { action: "SET_DELIVERY_CONTEXT", pincode, qty });
        const parts = [];
        parts.push(result.pincodeSet ? "pincode set" : "pincode field not found");
        parts.push(result.qtySet ? "quantity set" : "quantity field not found");
        statusEl.textContent = parts.join(", ") + ". If a field wasn't found, use Diagnose Page to locate it.";
      });
    } catch (e) {
      statusEl.textContent = "Could not apply delivery details. Reload the GeM tab and try again.";
    } finally {
      setBusy(false);
    }
  });

  btnQuickScan.addEventListener("click", async () => {
    setBusy(true);
    statusEl.textContent = "Scanning current results…";
    try {
      await withGemTab(async (tab) => {
        const result = await chrome.tabs.sendMessage(tab.id, { action: "SCRAPE_CURRENT_LISTINGS" });
        if (!result || !result.ok) {
          statusEl.textContent = `Scan failed (${(result && result.error) || "unknown error"}).`;
          return;
        }
        const ranked = (result.cards || [])
          .filter((c) => c.price)
          .sort((a, b) => parseFloat(a.price) - parseFloat(b.price))
          .slice(0, 4)
          .map((c, i) => ({ rank: "L" + (i + 1), ...c, matchedParameters: "(quick scan - current page as-is)" }));
        await chrome.storage.local.set({ [RESULTS_KEY]: ranked });
        statusEl.textContent = ranked.length
          ? `Found ${result.cards.length} listing(s), saved top ${ranked.length} as L1-L${ranked.length}.`
          : "No priced listings found on this page.";
        refreshStatusUI();
      });
    } catch (e) {
      statusEl.textContent = "Could not scan. Reload the GeM tab and try again.";
    } finally {
      setBusy(false);
    }
  });

  btnRunSmart.addEventListener("click", async () => {
    const { required, freeGroups } = buildRequiredAndFree();
    if (!required.length && !freeGroups.length) {
      statusEl.textContent = "Set at least one parameter to Required or Auto-vary first (see Golden Parameters above).";
      return;
    }
    const maxCombos = parseInt(maxCombosEl.value, 10) || 20;
    const totalCombos = freeGroups.reduce((n, g) => n * Math.max(1, g.options.length), 1);
    const ok = confirm(
      `This will try up to ${Math.min(maxCombos, totalCombos)} parameter combination(s) on the GeM tab, checking the ` +
        `results panel after each one, then rank the winning combination's listings by price. It runs on the GeM tab ` +
        `itself - keep it open. Continue?`
    );
    if (!ok) return;

    setBusy(true);
    statusEl.textContent = "Starting smart combination search…";
    try {
      await withGemTab(async (tab) => {
        await chrome.tabs.sendMessage(tab.id, {
          action: "RUN_COMBINATION_SEARCH",
          required,
          freeGroups,
          maxCombos,
          category: categoryLabelFromUrl((categoryUrlInputEl.value || "").trim()),
          pincode: (pincodeInputEl.value || "").trim(),
          qty: (qtyInputEl.value || "").trim(),
        });
      });
      refreshStatusUI();
    } catch (e) {
      statusEl.textContent = "Could not start the search. Reload the GeM tab and try again.";
      setBusy(false);
    }
  });

  btnCancel.addEventListener("click", async () => {
    const tabs = await chrome.tabs.query({ url: "https://mkp.gem.gov.in/*" });
    if (!tabs.length) {
      statusEl.textContent = "No GeM tab found to cancel.";
      return;
    }
    try {
      await chrome.tabs.sendMessage(tabs[0].id, { action: "CANCEL_COMBINATION_SEARCH" });
    } catch (e) {
      /* tab may be between renders - the running loop still checks the cancel flag in storage */
    }
    statusEl.textContent = "Cancelling… stops after the combination currently in progress.";
  });

  btnDiagnose.addEventListener("click", async () => {
    setBusy(true);
    statusEl.textContent = "Reading the page for diagnostics…";
    debugOutputEl.style.display = "none";
    try {
      await withGemTab(async (tab) => {
        const result = await chrome.tabs.sendMessage(tab.id, { action: "DIAGNOSE_PAGE" });
        if (result && result.ok) {
          const lines = [];
          lines.push("=== Product Specifications section (Golden Parameters) ===");
          if (!result.specSection || !result.specSection.found) {
            lines.push('NOT FOUND - the heading "Product Specifications" could not be located on this page.');
          } else {
            lines.push(`Found ${result.specSection.groupCount} spec group(s):`);
            result.specSection.groups.forEach((g) =>
              lines.push(`  ${g.golden ? "🟡 GOLDEN" : "plain    "} "${g.name}" — ${g.optionCount} option(s): ${JSON.stringify(g.options)}`)
            );
          }
          lines.push(`\nProduct cards found: ${result.productCardCount}`);
          lines.push(JSON.stringify(result.sampleCards, null, 2));
          lines.push(`\nCheckboxes found (whole page): ${result.checkboxCount} (showing up to 60)`);
          result.checkboxes.forEach((c) =>
            lines.push(`#${c.index} id="${c.id}" name="${c.name}" heading="${c.heading}" label="${c.label}" checked=${c.checked}`)
          );
          lines.push(`\nText/number/search inputs found: ${result.textInputCount} (showing up to 30)`);
          result.textInputs.forEach((t) =>
            lines.push(`#${t.index} type=${t.type} id="${t.id}" name="${t.name}" placeholder="${t.placeholder}" ariaLabel="${t.ariaLabel}"`)
          );
          debugOutputEl.value = lines.join("\n");
          debugOutputEl.style.display = "block";
          debugOutputEl.select();
          statusEl.textContent = "Diagnostics ready below. Copy and share this text if search/params/scan aren't working.";
        } else {
          statusEl.textContent = `Could not read the page (${(result && result.error) || "unknown error"}).`;
        }
      });
    } catch (e) {
      statusEl.textContent = "Could not read the page. Reload the GeM tab and try again.";
    } finally {
      setBusy(false);
    }
  });

  btnExport.addEventListener("click", async () => {
    const data = await chrome.storage.local.get(RESULTS_KEY);
    const rows = data[RESULTS_KEY] || [];
    if (!rows.length) {
      statusEl.textContent = "Nothing to export yet - run a search first.";
      return;
    }
    const outRows = rows.map((r) => [
      r.rank || "",
      r.priceText || r.price || "",
      r.title || "",
      r.seller || "",
      r.link || "",
      r.matchedParameters || "",
      r.category || categoryLabelFromUrl((categoryUrlInputEl.value || "").trim()),
      r.pincode || (pincodeInputEl.value || "").trim(),
      r.qty || (qtyInputEl.value || "").trim(),
    ]);
    const LINK_COL = EXPORT_HEADERS.indexOf("Product Link");
    const bytes = buildXlsx(EXPORT_HEADERS, outRows, { hyperlinkColumns: [LINK_COL] });
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const a = document.createElement("a");
    a.href = url;
    a.download = `gem_l1_rates_${stamp}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });

  btnClear.addEventListener("click", async () => {
    const ok = confirm("Clear saved results and loaded Golden Parameters?");
    if (!ok) return;
    await chrome.storage.local.set({ [RESULTS_KEY]: [], [STATUS_KEY]: null, [PARAMS_UI_KEY]: null });
    state = { groups: [], selections: {} };
    renderParams();
    refreshStatusUI();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes[STATUS_KEY] || changes[RESULTS_KEY])) refreshStatusUI();
  });

  loadParamsUI();
  refreshStatusUI();
})();
