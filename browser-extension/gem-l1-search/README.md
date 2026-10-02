# GeM L1 Rate Finder (Chrome Extension)

Searches a category on GeM Marketplace (`mkp.gem.gov.in`), lets you lock the
**Golden Parameters** (per-category specification filters) you actually need
to a required value, auto-varies the rest, finds which combination has the
most matching listings, and exports the cheapest four (**L1, L2, L3, L4**)
as product links + prices into one `.xlsx` file.

Zero external dependencies — the Excel writer is the same hand-written,
dependency-free `lib/xlsx-writer.js` used by this repo's other GeM
extension (`gem-bid-exporter`), since Chrome Web Store policy requires
everything to be bundled locally (no remote code) and there was no network
access here to pull in SheetJS.

## Install (load unpacked)

1. Open Chrome → `chrome://extensions`.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** → select this folder (the one with
   `manifest.json` in it).
4. Pin the extension (puzzle-piece icon → pin "GeM L1 Rate Finder").

## How to use it

1. **GeM Category Search URL** — open the category yourself on
   `mkp.gem.gov.in`, copy its address-bar URL (looks like
   `mkp.gem.gov.in/hand-tools-measuring-and-layout-tools-universal-bevel-protractor/search`),
   paste it in and click **Open This Category Page**. GeM's search doesn't
   behave like a plain type-and-submit box — it resolves to a
   category-specific URL — so this navigates straight there instead of
   trying to automate GeM's own search box.
2. **Load Golden Parameters From Page** — reads the **Product
   Specifications** filter panel specifically (the one nested under
   "Make/Model Selection" in GeM's left filter sidebar), expands every
   collapsed spec row automatically, and flags the ones GeM itself marks
   with a small golden/amber info icon (e.g. "Calibration Certificate
   Provided By Supplier" in a real example) as 🟡 **GOLDEN** — vs a plain
   spec like "Number Of Arms" or "ISO 9001 Certified" that doesn't carry
   that marker. Every spec in the section still shows up either way (in
   case the golden-icon detection misses one — see Known limitations), just
   without the 🟡 tag. For each group you get three modes:
   - **Required (fix)** — turns into a single-select: pick the *one* value
     you actually need (e.g. RAM = 8GB). This gets applied and held fixed
     for every combination tried below.
   - **Auto-vary** — turns into a multi-select: tick every option you're
     open to (e.g. Brand = Dell, HP, Lenovo). The tool will try each one
     (and every combination across all Auto-vary groups) while searching.
   - **Ignore** (default) — leaves that filter untouched at GeM's default.
3. **Consignee / Delivery & Quantity** — enter a pincode and/or quantity and
   click **Apply Pincode + Quantity On Page**. This is best-effort (see
   Known limitations below).
4. **Run**:
   - **Quick Scan Current Results (no combos)** — just reads whatever is on
     screen right now and ranks it by price. Fast, no automation.
   - **Run Smart Search — Required + Auto-vary → L1-L4** — the full
     workflow: fixes every Required parameter, then tries every combination
     of the Auto-vary parameters (capped by **Max combinations to try**,
     default 20), reading the results panel after each one. Whichever
     combination returns the **most matching listings** is treated as the
     real competitive set (so L1-L4 come from an actual comparison, not a
     single leftover SKU with 0-1 sellers) — its listings are then sorted
     by price and the cheapest four become L1/L2/L3/L4.
   - **Cancel Running Search** stops it after the combination currently in
     progress.
5. **Export L1-L4 to Excel** downloads a `.xlsx` with Rank, Price, Product
   Title, Seller, Product Link (a real clickable hyperlink), Matched Golden
   Parameters, Category, Pincode, and Qty.

Results and loaded parameters survive closing the popup (they live in
`chrome.storage.local`) — just don't close the GeM tab mid-run.

## Known limitations (please read before relying on this)

This was written **without ever having direct access to the live
`mkp.gem.gov.in` DOM** — no network access to the real site from where this
was built, same situation this repo's `gem-bid-exporter` documents for its
own advance-search automation. The Golden Parameter section and product
cards were refined against a real screenshot, which is a lot better than a
blind guess but still not the same as loading the page. Every selector is a
generic heuristic, not a hardcoded id:

- **Finding the "Product Specifications" section**: `findSectionByHeadingText()`
  in `content.js` looks for a leaf element whose text is exactly "Product
  Specifications", then climbs up to the nearest ancestor that actually
  contains checkboxes / collapsible toggles. If GeM ever renames that
  heading or nests it differently, this is the function to fix.
- **Expanding collapsed specs**: `expandAllWithin()` clicks every element
  with `aria-expanded="false"` inside that section. If GeM's accordion
  doesn't use `aria-expanded` (some just toggle a CSS class), this won't
  expand anything and Golden Parameters with no options showing is the
  symptom — Diagnose Page's "Product Specifications" dump will show 0
  options for every group in that case.
- **Golden-icon detection**: `hasGoldenMarkerNear()` looks for a small icon
  element near each spec's heading whose color is amber/gold-ish
  (`isGoldenColor()` in `content.js` checks the icon's computed
  `color`/`background-color`/`fill` against an RGB threshold), or whose
  `title`/`aria-label`/`alt`/class mentions "golden"/"mandatory". This is a
  color-based guess, not a class-name match, because the actual markup
  behind that icon has never been inspected directly. **Diagnose Page now
  reports, per spec found in Product Specifications, whether it was flagged
  🟡 GOLDEN or plain** — if a spec you know is golden isn't tagged (or vice
  versa), share that output so the RGB thresholds in `isGoldenColor()` can
  be corrected against the icon's real computed color.
- **Golden Parameter option groups**: within Product Specifications, each
  spec's checkboxes are grouped by scanning every `<input
  type="checkbox">` inside that section, reading its label (via `<label
  for>`, a wrapping `<label>`, or the next sibling's text), then walking up
  the DOM to the nearest heading-like element (`h1`-`h6`, `legend`, or a
  `.filter-title`/`.title`/`.filter-heading` class) for the group name.
  Checkboxes with no findable heading land in an "Other Specification"
  bucket rather than being dropped. `checkboxLabel()` / `checkboxHeading()`
  in `content.js` are where to fix this if a spec's markup doesn't match.
- **Product listing cards**: found by looking for `<a>` tags whose `href`
  contains "product"/"item"/"catalog" text, then climbing up from each one
  until landing on a container whose text has *exactly one* ₹ price (more
  than one means the climb went past the card into the whole results
  list). `findProductCards()` in `content.js` is where to adjust the anchor
  match or price regex if this misses real cards or grabs too much.
- **Seller name**: only captured if the card's text contains "Sold by" or
  "Seller" followed by a name — often blank otherwise. Not a bug if GeM's
  card doesn't show a seller name at all in the list view.
- **Pincode / Quantity fields**: matched purely by keyword
  (id/name/placeholder/aria-label containing "pincode" or "qty"/"quantity")
  on whatever page is currently open. GeM often only shows a
  freight-adjusted "landed price" after opening a specific product and
  entering pincode/qty *there* — this tool does not open every product's
  detail page to check that, so the price shown in your L1-L4 export is the
  **listed unit price**, not necessarily the final delivered price for your
  exact pincode/qty. Click through the exported links to confirm before
  relying on it for a quote.
- **Combination search re-render timing**: after checking/unchecking
  filters, the code waits a fixed 1.2s before re-scraping. If GeM's results
  take longer to refresh (slow network, more filters), that combo's listing
  count can come back short. Bump the `await sleep(1200)` in
  `runCombinationSearch()` if combos are coming back with suspiciously few
  results.

**Use Diagnose Page first if anything above doesn't work.** It dumps the
Product Specifications section's own diagnostic (found or not, each spec
group with its golden flag and options), every checkbox on the whole page
(id/name/heading/label), every text/number input, and whatever product
cards it currently detects — copy that output and share it (the same way
the Consignee State/City dropdown mismatch got fixed in `gem-bid-exporter`,
by comparing what the matcher found against a real dropdown list) to get
the selectors corrected quickly. **Test once on a single category before
trusting a big multi-combination run.**

## Files

- `manifest.json` — extension config (Manifest V3), scoped to
  `https://mkp.gem.gov.in/*`.
- `popup.html` / `popup.js` — the toolbar popup: category URL navigation,
  Golden Parameter mode selection, delivery inputs, run controls, results
  table, Excel export, Diagnose Page.
- `content.js` — runs on the GeM page: Product Specifications section
  scanning + golden-icon detection + toggling, product-card scraping, the
  combination-search loop, and the diagnostic dump.
- `lib/xlsx-writer.js` — dependency-free `.xlsx` file writer (shared, byte-
  for-byte, with `gem-bid-exporter`'s copy).
