# Changelog

All notable changes to the **Dev OMS** project will be documented in this file.

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
