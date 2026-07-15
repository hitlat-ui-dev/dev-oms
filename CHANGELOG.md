# Changelog

All notable changes to the **Dev OMS** project will be documented in this file.

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
