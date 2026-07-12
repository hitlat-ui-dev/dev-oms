# Changelog

All notable changes to the **Dev OMS** project will be documented in this file.

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
