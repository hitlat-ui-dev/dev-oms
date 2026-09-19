# GeM Bid Exporter (Chrome Extension)

Scrapes the bid list on `bidplus.gem.gov.in` (Advance Search results), optionally
walks through every results page, optionally opens each bid's PDF document and
pulls out a fixed set of fields, and exports everything into a single `.xlsx`
file — all from a small popup, no coding needed to use it day-to-day.

It has **zero external dependencies** — no SheetJS, no pdf.js. The Excel writer
and the PDF text extractor are both small hand-written scripts bundled inside
the extension, because this was built in a sandboxed environment with no
network access to fetch those libraries, and because Chrome Web Store policy
requires everything to be bundled locally anyway (no remote code).

## Install (load unpacked)

1. Unzip this folder somewhere permanent (don't delete it after installing —
   Chrome loads the extension from these files every time).
2. Open Chrome → `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** → select this folder (the one with `manifest.json`
   in it).
5. Pin the extension (puzzle-piece icon in the toolbar → pin "GeM Bid Exporter").

## Fixed: Start Sync (from the OMS) not being picked up

The OMS's **Start Sync** button creates a "scraping" run in its database;
this extension's background worker (`background.js`) polls the OMS every 15s
for that run and, once claimed, drives the scrape. That polling/posting goes
to whatever URL is in the popup's **OMS Server URL** field — but the built-in
fallback used when that field was never set used to be `http://localhost:3000`,
not the actual deployed OMS. If nobody ever opened the popup to type in the
real URL, every poll silently went to localhost while the run sat in the
deployed OMS's database, never picked up — Start Sync looked like it did
nothing. The fallback now defaults to the deployed OMS
(`https://dev-oms-blush.vercel.app`, already a static `host_permission` so no
extra prompt is needed) — a local-dev OMS still works by typing
`http://localhost:3000` into that same field, which always takes priority
over the fallback. Also remember: the automated Start-Sync flow scrapes
whatever the GeM tab is currently showing (see the new filters section below
for narrowing that), so a GeM tab logged in and open (any bidplus.gem.gov.in
page is enough for the poller to run) is still required for it to be picked
up at all.

## New: item-keyword and best-effort date-range filters

Two new popup fields under **Consignee State/Cities**:

- **Only keep bids where Items contains** / **Skip bids where Items
  contains** — comma-separated, case-insensitive substring match against the
  Items field. Applied to every row before it's saved anywhere — manual
  scans, city batches, and the automated Start-Sync flow triggered from the
  OMS all funnel through the same check (`filterRowsByItemKeywords()` in
  `content.js`), even if the popup is closed at the time (settings persist in
  `chrome.storage.local`). Filtering happens before each row's PDF is
  fetched, not after, so excluded rows don't cost the extra fetch either.
  This is separate from, and in addition to, the OMS's own server-side
  category exclusion list (`lib/gemBids/exclusionKeywords.json` in the OMS
  repo), which still applies afterward to whatever does get sent.
- **Bid Start Date range** (From/To) — best-effort, same honesty caveat as
  the consignee state/city matching below: these fields are matched by
  keyword guess against GeM's Advance Search form, not confirmed ids, since
  this was written without live access to that page. Leaving both blank
  skips this step entirely (zero risk to existing behavior). If a value
  doesn't take, open **Diagnose Page** — it now also lists every text input
  on the page (previously just dropdowns) — find the real id/name of GeM's
  Bid Start Date From/To fields, and add it to the keyword list near
  `applyBidStartDateFilter()` in `content.js`.

## New: any state, not just Gujarat

**Consignee State** is now a free-text field (with a dropdown of Indian state
names for convenience) instead of being locked to "Gujarat" — the matching
logic in `content.js` (`findConsigneeStateSelect`) was already
state-agnostic, this was purely a popup UI restriction. Type any state name
GeM's own dropdown lists; **Load All Cities From GeM** and **Search + Scan
These Cities** both use whatever's typed there.

## New: automated consignee-city search (no manual clicking through Advance Search)

Instead of opening `bidplus.gem.gov.in/advance-search`, clicking "Search by
Consignee Location", picking the state and city, and *then* opening the
extension every time, the popup now has a **Consignee State / Consignee
Cities** box:

1. Click the extension icon (you don't need a GeM tab open first — it'll
   open or reuse one).
2. State is fixed to Gujarat. Click **Load All Cities From GeM (Gujarat)**
   — this opens/reuses the GeM tab, selects Gujarat on the real Advance
   Search → Consignee Location form, and reads back whatever cities GeM's
   own Consignee City dropdown actually lists, one per line, into the
   **Consignee Cities** box. Review/edit the list if you want (delete
   ones you don't need, or leave it as-is for every city). You can also
   still type city names in by hand instead, or leave the box blank to
   search the whole state without a city filter.
3. Click **Search + Scan These Gujarat Cities**, confirm the prompt.
4. From there it runs unattended, one city at a time: navigates the GeM tab
   to Advance Search → Consignee Location, selects the state/city, submits
   the form, then paginates through every results page and pulls every
   bid's PDF details — same as Auto-Scan — before moving to the next city.
   Everything lands in the **same** saved-rows table, with the city that
   was searched written into a new **Consignee City** column (first column
   in the exported sheet).
5. This runs on the GeM tab itself, not in the popup, so you can close the
   popup once it starts — just don't close the GeM tab. Reopen the popup
   any time to see progress ("[2/4] Surat — scanning pages + PDFs…").
   **Cancel Running City Batch** stops it after the results page currently
   in progress.
6. When every city in the list has been searched and scanned, the
   extension **automatically builds and downloads the `.xlsx` file** —
   you don't need to click "Export to Excel" yourself for this flow (that
   button is still there for manual/partial scans, or if you want to
   re-export what's collected so far mid-run). The auto-downloaded file is
   named `gem_bids_gujarat_<timestamp>.xlsx` and lands wherever your
   browser normally saves downloads.

**Update:** the state/city selector bug described below has been found and
fixed — the real Consignee State/City dropdowns are `#state_name_con` and
`#city_name_con`; the code was previously grabbing a decoy dropdown
(`#buyer_state`) that also happens to contain the word "state". Both are
now matched by exact id first, with a content-based fallback (a select
whose options literally include the state name) if GeM ever changes those
ids. If a city search still doesn't work, use the popup's **Diagnose Page**
button (lists every dropdown on the page) and share that output rather than
guessing blind - that's what got this one fixed.

**Important honesty note on this part specifically:** the code that selects
the state/city dropdowns and clicks Search
(`runConsigneeSearch`/`getCityOptionsForState`/`findStateSelect`/`findSelectByKeywords`
in `content.js` — the last two also back the new **Load All Cities From
GeM** button) was written without being able to load the live
`bidplus.gem.gov.in/advance-search` page — the site's `robots.txt` blocks
automated fetches from outside a real browser (confirmed again while
debugging this), so nothing in this build has ever actually seen that
page's real HTML. The state dropdown is now matched two ways: first by
searching every `<select>` on the page for one that literally lists
"Gujarat" as an option (a fixed, guaranteed-correct signal, since only the
real state dropdown would contain real Indian state names), falling back
to the old id/name/label keyword guess only if that finds nothing. This is
a meaningfully stronger match than before, but it's still unverified
against the live DOM — if it's a heavily customized widget (not a plain
`<select>`, e.g. a fully custom JS dropdown with no underlying `<select>`
element at all) it can still fail. The city dropdown and Search button are
still matched purely by id/name/label keyword (id/name/label text
containing "state", "consignee city", etc.), the same style as the
pre-existing `findNextControl()`/`findBidCards()` (which *was* validated,
just against a screenshot, not the live DOM). **Test it once on a single
city before trusting it for a full multi-city overnight run.** If it can't
find the state or city dropdown, or can't find the Search button, the
status line in the popup will say exactly which step failed
(`state_select_not_found`, `city_select_not_found`,
`city_option_not_found`, `search_button_not_found`, `no_results_detected`)
— open DevTools on the GeM tab (`F12` → Elements), inspect the field in
question, and add its actual `id`/`name` string to the matching keyword
list near the top of `runConsigneeSearch` in `content.js`. That's the one
part of this whole extension that's genuinely untested against the real
site.

The **Consignee City** column is filled in from the city you searched for,
not scraped per-bid — see the "Table-style fields" note further down for
why the PDF's own consignee/address table isn't reliable enough to pull
this from automatically. If the same bid legitimately lists more than one
consignee city, it can appear more than once in your export (once per city
searched), rather than being silently merged into a single row.

## How to use it (manual scanning, still available)

1. Log in to GeM and open the Advance Search results page — the one showing
   cards like `BID NO: GEM/2026/B/7698664`, `Items:`, `Quantity:`, `Start Date:`,
   `End Date:`.
2. Click the extension icon. You'll see three scan buttons:
   - **Scan This Page (fast, no PDF)** — grabs the visible list only (Bid No,
     Items, Quantity, Department, Start/End Date). Instant.
   - **Scan This Page + PDF Details** — same as above, plus opens each bid's
     document link and pulls the extra fields (EMD amount, bid end date/time,
     type of bid, evaluation method, etc.). Slower — one fetch per bid.
   - **Auto-Scan ALL Pages + PDF Details** — clicks through every results page
     automatically and does the above for every bid on every page. Keep the
     GeM tab open and in the foreground while this runs; it can take a while
     for 90+ records since each bid's PDF is opened and parsed one at a time.
3. Rows are saved as you go (survives closing the popup — just don't close the
   GeM tab mid-scan). Reopen the popup any time to see the running count.
4. Click **Export to Excel** to download a `.xlsx` with everything collected
   so far. **Clear Saved Data** wipes it and starts fresh.

You can mix and match — e.g. run "Scan This Page + PDF Details" on a couple of
pages you care about instead of the full auto-scan.

## What ends up in the Excel file

One row per bid, columns:

`Consignee City, Bid No, Bid Link, Items, Quantity (Listing), Department
Name And Address, Start Date`, followed by whatever was found in the PDF
for: `Bid End Date/Time, Document required from seller, Bid to RA enabled,
RA Qualification Rule, Type of Bid, Evaluation Method, EMD Amount,
Beneficiary, Address, Buyer Added Bid Specific ATC`.

(`End Date`, `PDF Status`, `Consignee Reporting/Officer`, and `Additional
Requirement` were removed from the sheet on request. `PDF Status` is still
tracked internally per row - it's just not shown in the export - so if a
bid's PDF failed to parse you won't see why from the sheet alone anymore.)

- **Bid Link** is a real clickable hyperlink (not just text that looks like
  a URL) pointing at the actual PDF file GeM served, when the extension
  managed to resolve one - clicking it opens/downloads the PDF directly,
  the same way any PDF link behaves in your browser (whether it downloads
  or opens in a viewer tab depends on your browser's own PDF settings, not
  on this extension). If the PDF couldn't be resolved (captcha, not a PDF,
  fetch error), this falls back to the original bid listing-page link
  instead, so the cell is never empty.
- **RA Qualification Rule** is extracted the same generic way as every
  other PDF field (matches the label, grabs the text up to the next row) -
  it'll come through as whatever the PDF actually says there, e.g.
  "H1-Highest Priced Bid Elimination" or "50%". It's often blank because,
  per GeM's own form, it only exists when "Bid to RA enabled" is Yes.
- **Address** now pulls the whole Consignee/Reporting Officer/Quantity
  table block as one combined chunk of text, instead of being left blank.
  This extractor works on a flattened text stream with no per-cell
  position data, so it genuinely can't split that table into clean
  per-consignee Name/Address/Quantity columns - what you get is the raw
  table content (header row plus every consignee row) as it appears in the
  PDF, Devanagari stripped. If you need it split into separate columns per
  consignee, that needs a real rewrite of the PDF text extractor to track
  each text run's on-page position, which isn't implemented.
- **Buyer Added Bid Specific ATC** is also a real hyperlink when the PDF
  embeds one (see the note further down on when that is/isn't the case).

`PDF Status` (tracked internally, not exported) still records what
happened per bid: `ok` (fields extracted), `not_pdf` (the link didn't lead
to a PDF the extension could find), `captcha_blocked` (GeM put a captcha
in the way — open that one manually), `no_link` (couldn't find a document
link on the card), or an `http_XXX` / `error: ...` message.

**Highlighting:** any row whose **Items** cell contains the phrase
"Paper-Based Printing Services" (case-insensitive, substring match — so
"Paper-Based Printing Services - Brochures" also matches) gets its entire
row filled yellow in the exported sheet. This applies both to the manual
**Export to Excel** button and the automatic download at the end of a city
batch. The exact phrase is set near the top of `exportRowsToXlsx()` in
`content.js` (and mirrored in the `btnExport` handler in `popup.js`) as
`HIGHLIGHT_ITEM_TERM` — change it there if you need a different phrase or
more than one.

## Known limitations (please read before relying on this)

The PDF text extractor (`lib/pdf-extract.js`) has been tested directly
against a real bid PDF downloaded from GeM (`GeMBidding9577744.pdf`, 35
pages) and correctly pulls out real values — bid end date/time, EMD amount,
type of bid, evaluation method, beneficiary, documents required, etc. An
earlier version of this extractor did not (it returned everything empty);
that's fixed now. The bid-*listing* scrape (`findBidCards()` /
`findNextControl()` in `content.js`) is still based on a screenshot of the
results page rather than the live site, since that site isn't reachable from
where this was built — if scraping the list itself doesn't work, those two
functions are the ones to adjust first.

Things that are still worth knowing about:

- **"Next page" doesn't advance**: `findNextControl()` looks for a clickable
  element whose text is "Next", "»", or ">" and isn't disabled. If GeM's
  pagination control is worded differently, update the matching there. "Scan
  This Page" still works as a manual per-page fallback regardless.
- **PDF documents require a captcha or login redirect**: some GeM downloads
  are gated this way. Those rows come back with `PDF Status = captcha_blocked`
  or `not_pdf` and empty detail columns — the `Bid Link` column is still
  filled in so you can open and check those manually.
- **A field is legitimately blank**: not every field applies to every bid —
  e.g. "RA Qualification Rule" only exists when "Bid to RA enabled" is Yes,
  and "Additional Requirement" only appears if the buyer filled it in. An
  empty cell often just means that section wasn't in that particular bid.
- **Field values stop at the next table row, not just the next tracked
  label**: every field in these PDFs is a row of "<Hindi label> /<English
  label>" followed by its answer, one after another. The extractor now
  recognizes that pattern generically — once it has a field's own label, it
  grabs the answer only up to whichever comes first: the next field we're
  searching for, or literally *any* next Hindi/English row (even ones we
  never asked about). That's what keeps a short answer like "EMD Amount" →
  `10345` from swallowing every unrelated row that happened to follow it in
  the PDF before the next field on our list showed up. If a bid's PDF ever
  uses a differently-punctuated row separator than "<Devanagari text>
  /<English text>", that particular row boundary won't be recognized and
  the old "runs until the next tracked label" behavior kicks back in for
  that one field — `ROW_BOUNDARY_RE` in `lib/pdf-extract.js` is where to
  adjust if that comes up.
- **Table-style fields (Consignee / Reporting Officer / Address / per-item
  Quantity)**: these come from an actual table in the PDF (columns: S.No,
  Consignee/Reporting Officer, Address, Quantity, Delivery Days), one row per
  consignee. The extractor turns the whole PDF into a single flat text
  stream with no per-token position data, so it can't cleanly split that
  table into one value per column - **Address** now instead captures the
  *entire* table block (header row through every consignee's row) as one
  combined chunk of Devanagari-stripped text, rather than being left blank.
  That's an honest "here's that section's actual content" rather than a
  false promise of clean per-consignee columns. If you need it properly
  split, that needs real table reconstruction (tracking each text run's
  on-page position and grouping by row), which isn't implemented — flag it
  if it's important and it can be added.
- **PDF field wording doesn't match**: `PDF_FIELD_LABELS` near the top of
  `content.js` (mirrored in `popup.js`) is the exact list of English label
  fragments it searches the PDF text for; it grabs whatever text sits
  between one matched label and the next row boundary (see above). If a
  bid's exact wording differs (an extra word, different punctuation) the
  match can be off or empty — widen/adjust the string in that list.
  Whitespace in a label is already treated as flexible (so a label that
  wraps across two lines in
  the PDF still matches), so this should only need a name change.
- **Hindi/Devanagari is stripped on purpose**: every PDF field value is
  English-only in the export — any Devanagari text mixed into the source
  PDF (these bid PDFs are bilingual, Hindi label followed by "/English
  label") is removed before the value is saved, along with the leftover
  "/" separator and extra blank lines that stripping it out would
  otherwise leave behind. If you ever need the Hindi text too, that's a
  one-line change in `stripDevanagari()` in `lib/pdf-extract.js` to turn
  it off.
- **"Buyer Added Bid Specific ATC"**: this cell contains *only* the actual
  URL behind "Click here to view the file" — not the sentence, not the
  disclaimer paragraph that follows it in the PDF. That URL only ends up in
  the cell when the bid's PDF actually embeds a real clickable link (a
  `/Subtype /Link` annotation) for this field; when it doesn't, the cell is
  left blank rather than showing any placeholder text. In practice, testing
  against a real GeM bid PDF showed that most of these PDFs do **not**
  embed an actual hyperlink here at all — "Click here to view the file" is
  only clickable on GeM's website (a JavaScript-driven download, tied to
  the bid's document ID behind the scenes), and that action isn't written
  into the static PDF you download, so there's nothing in the file itself
  to extract as a URL. A blank cell for this field usually means exactly
  that — it's the PDF's own limitation, not a bug in the extractor. If a
  particular bid's PDF *does* have that link embedded, it comes through
  automatically with no configuration needed.
- **Scanned/image-only PDFs**: won't yield any text (no OCR here).

If a bid comes back with something unexpected, the fastest way to get it
fixed is to share that specific bid's PDF (like the one used to test this) —
real files surface real formatting quirks that are hard to predict.

## Files

- `manifest.json` — extension config (Manifest V3).
- `popup.html` / `popup.js` — the toolbar popup UI and Excel export.
- `content.js` — runs on the GeM page: scrapes the list, paginates, fetches
  and parses bid PDFs, saves everything to `chrome.storage.local`.
- `lib/pdf-extract.js` — dependency-free PDF text extractor (used by both the
  content script and, indirectly, the field-matching in the listing scrape).
- `lib/xlsx-writer.js` — dependency-free `.xlsx` file writer.
- `icons/` — toolbar icons.
