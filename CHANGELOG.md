# Changelog

All notable changes to the **Dev OMS** project will be documented in this file.

## [1.3.2] - 2026-08-28

### Added
- **🧾 Bank Reconciliation — Match Details Drawer**:
  - Added a "Details" button on each Pending Review row ([reconciliation/page.tsx](file:///d:/dev_oms/dev-oms/app/dashboard/account/reconciliation/page.tsx)) opening a modal with the credited transaction's date, description, and amount alongside a full line-item breakdown (bill no, item name, qty, rate, total) for every matched bill.
  - Combo matches (a payment settled across multiple bills) list each bill's line item individually with a summed "Combo Total" footer row.
  - Added a `GET` handler on `/api/reconciliation/matches/[id]` ([route.ts](file:///d:/dev_oms/dev-oms/app/api/reconciliation/matches/%5Bid%5D/route.ts)) returning the match plus its resolved `sellerorders` line items.

- **🔗 GeM Catalogue — Auto-Filled "Link to Inventory"**:
  - A catalogue row whose GeM product is already mapped in the Master List now shows **which inventory item** it's linked to (SKU + item name, with a "Linked" badge) instead of an empty "Search or select stock..." box.
  - Matching is on GeM's own **product id + firm**, normalized from either side via a new shared `normalizeGemProductId` helper in [lib/gemSync/catalogueMatch.ts](file:///d:/dev_oms/dev-oms/lib/gemSync/catalogueMatch.ts) — it reads the id out of a product URL (`.../p-5116877-9610340384-cat.html#variant_id=...`) or a bare catalogue-id cell, so a hand-pasted `gemLink` and GeM's own href resolve to the same key.
  - Previously [catalogue/page.tsx](file:///d:/dev_oms/dev-oms/app/dashboard/gem-sync/catalogue/page.tsx) keyed this off `gemCatalogueId` alone, which is written only by its own "Add to Master List" button — so just **2** of 858 live listings were reachable and the other **847** (every listing created through the Sheet Library / Requirement Mapping flow) always rendered as unlinked. **441** catalogue rows now resolve correctly.
  - The Name column's green check now prefers this exact product-id match over the old name-similarity guess, falling back to fuzzy matching only for unlinked rows.
  - Display-only — no writes. Note the filled name is the *internal* inventory name and often differs from GeM's product title (e.g. GeM "General Breadboard Circuit board" → "BREAD BOARD"); the tooltip states which id it matched on.

### Fixed
- **🙈 GeM Sync — Hidden Inventory Items Still Offered in Pickers**:
  - Items hidden in Inventory no longer appear in the Requirement Mapping Console's "Search or select stock..." dropdown, the "Build From Scratch" item picker ([gem-sync/page.tsx](file:///d:/dev_oms/dev-oms/app/dashboard/gem-sync/page.tsx)), or the GeM Catalogue's "Link to Inventory" picker ([catalogue/page.tsx](file:///d:/dev_oms/dev-oms/app/dashboard/gem-sync/catalogue/page.tsx)) — 27 hidden items were previously selectable in all three.
  - Typing a hidden item's exact name no longer selects it either, not just the dropdown options.
  - Filtering is applied **only at the point of selection**, via new `selectableItemsList` / `selectableStockItems` memos — the underlying lists stay whole on purpose: 11 existing Master List entries are mapped to items that were hidden after the fact and must still resolve to their name, and the custom-item SKU counter (`"S" + (1100 + stockItems.length + customItems.length)`) would start reissuing taken SKUs if hidden items stopped being counted.
  - The equivalent filter already existed on the GeM Orders verify screen ([fetch-gem-orders/page.tsx:283](file:///d:/dev_oms/dev-oms/app/dashboard/orders/fetch-gem-orders/page.tsx)); that page needs only a redeploy.

- **📄 GeM Sync — Sheet Library Losing Saved Rows**:
  - Root cause was two separate races between the debounced auto-save effect and an async load/parse in [gem-sync/page.tsx](file:///d:/dev_oms/dev-oms/app/dashboard/gem-sync/page.tsx): (1) a freshly-picked Excel file being auto-saved before its `FileReader` parse finished, and (2) opening a sheet via "Resume Mapping" (or the page's auto-open-last-sheet-on-load) auto-saving the *previously* open sheet's stale/empty rows under the *newly* opened sheet's id, before its real content had finished loading from R2. Both now set a skip-next-autosave flag *before* switching the active sheet, not after its content arrives, so opening/resuming a sheet can never itself trigger a save.
  - Hardened `save_sheet` in [api/gem-sync/route.ts](file:///d:/dev_oms/dev-oms/app/api/gem-sync/route.ts) as a backstop at the data layer: it now refuses **any** save whose row count is lower than what's already stored for that sheet id — not just a full wipe to 0 — since no legitimate flow in this app ever shrinks an existing sheet's row count (a new upload always gets a fresh id; there's no per-row delete). Content can now only shrink to nothing via the explicit, confirm()-gated Delete Sheet action, never a silent auto-save.
  - Note: 9 sheets already stuck at `0` from before this fix (their R2-stored content was confirmed genuinely empty) need to be re-uploaded — the original parsed data was never durably saved, so there was nothing to recover.

## [1.3.1] - 2026-07-22

### Added
- **🏢 Seller Register Address in GeM Sync Excel**:
  - Added a new column "Seller Register Address" between "Min Qty" and "Mapped Firm" when downloading the filled Excel sheet.
  - Automatically fetches the address from the MongoDB company collection based on the mapped firm code.

### Fixed
- **🔑 Unique Key Prop warning**:
  - Resolved console warnings in the GeM Sync page by providing unique fallback keys (`_id || idx`) for mapping custom options and firm dropdown options.

## [1.3.0] - 2026-07-21

### Added
- **☁️ Automated Cloud Backups (R2 & Google Drive)**:
  - Integrated dual cloud backup providers: **Cloudflare R2** (`lib/cloudflareR2.ts`) and **Google Drive** (`lib/googleDrive.ts`).
  - Added background daily automatic backup trigger on initial user access to the app in [layout.tsx](file:///d:/personal/git-projects/dev-oms/app/layout.tsx).
  - Created MongoDB tracking schema ([BackupLog.ts](file:///d:/personal/git-projects/dev-oms/models/BackupLog.ts)) to log backup attempts.
  - Enhanced Admin Backup panel ([page.tsx](file:///d:/personal/git-projects/dev-oms/app/dashboard/admin/backup/page.tsx)) with instant cloud sync triggering, local ZIP compilation download, and a detailed backup execution history table.
- **🔌 GeM Chrome Extension Integration**:
  - Implemented CORS headers and preflight handling (`OPTIONS` method) in both orders and seller-orders API endpoints ([orders/route.ts](file:///d:/personal/git-projects/dev-oms/app/api/orders/route.ts) and [seller-orders/route.ts](file:///d:/personal/git-projects/dev-oms/app/api/seller-orders/route.ts)).
  - Supported direct MongoDB raw collection insertions for orders imported from the extension, allowing fallback values for mandatory fields when Mongoose validation is bypassed.
  - Added duplicate check based on `contractNo` returning conflict status code.
- **📥 Raw GeM Orders Viewer**:
  - Created [fetch-gem-orders](file:///d:/personal/git-projects/dev-oms/app/dashboard/orders/fetch-gem-orders/) sub-page and card entry in Orders dashboard to review, fetch, and verify raw orders synchronized via the GeM extension.
  - Created `gem-orders` API endpoint for syncing raw GeM extension orders database.

## [1.2.0] - 2026-07-15

### Added
- **🔔 Header Workspace To-Do & Chat Dropdowns**:
  - Moved workspace actions directly to the header, removing the redundant To-Do dashboard landing card.
  - **Tasks Checklist Popover**: Clicking "Workspace" toggles a checklist showing pending tasks, assignee tags, and an inline form to add quick tasks.
  - **Autocomplete `@name` suggestions**: Typing `@` in the task input opens a floating auto-filtered list of team members for instant assignment autocomplete.
  - **Direct Messages Popover**: Clicking "Chat" toggles a dual-pane direct messaging panel. Lists team members on the left with unread indicators, and a private message history with text input on the right.
  - **"All Members" Tab**: Integrates the shared group discussion channel directly into the Chat popup interface.
  - **Real-Time DM Notifications**: Renders a red pulsating notification badge on the header's Chat button when new messages arrive from other team members.
- **👥 Collaborative Workspace Workspace Page (`/dashboard/todo-chat`)**:
  - Created a full workspace view with a detailed To-Do dashboard (assignees, due dates, reminder dates) and Slack-style live chat room with auto-polling.
  - Refactored styles to support high-contrast light theme overrides.
- **📈 Seller Order GeM Stock Automation**:
  - Automated `availGemStock` decrement in `gem_listings` on order creation if a valid GeM contract URL is provided.
  - Disabled GeM stock changes during status transitions (cancellations, shipments, returns) as per client workflow rules.

## [1.1.0] - 2026-07-12

### Added
- **🔗 GeM Links Module (`/dashboard/gem-sync`):**
  - Created a new core module for uploading and mapping client requirement sheets.
  - **Shared Database State:** Fully integrated MongoDB Atlas REST endpoints (`/api/gem-sync`) supporting sheet saving, history log auditing, listings, and buyers.
  - **📁 Sheet Library Tab:** Support for storing, filtering, resuming, and deleting multiple uploaded spreadsheets.
  - **📋 Master List Tab:** A unified aggregate dashboard of all mapped items.
  - **Row Grouping (rowSpan):** Integrated visual cell merging for identical item names mapped across multiple firms (e.g. `SS`, `SATYA`).
  - **⚡ Auto-Fill & Quick Fill:** Selecting a mapped item automatically auto-fills previous firm, rate, stock, and GeM URL details. Shows quick-fill badges for items linked to multiple firms.
  - **🛡️ Access Controls:** Added `gemLinks` permission configuration in Settings and dynamic routing guards.
- **🌓 Persisted Dark/Light Mode Theme:**
  - Added Sun/Moon theme switcher to the header.
  - Stored preference in browser cookies (`oms_theme`) for persistence across sessions.
  - Added full light theme CSS styling overrides across all modules.
- **🛒 Orders Bulk Delivery & Searchable Transporters:**
  - Added bulk check checkboxes on the **READY TO SHIP** tab.
  - Integrated **Bulk Deliver** button to process multiple orders simultaneously.
  - Replaced standard select dropdown with a **searchable input datalist** in the Delivery Details popup.

## [1.0.0] - 2026-05-20
- Initial production release.
- Real-time Order & Inventory pipeline logic (`TO CHECK` -> `FULFILLED`).
- Optimistic Concurrency Control (OCC) double-click protection.
