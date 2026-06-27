# Dev OMS - Internal Management System Documentation

Dev OMS is a robust, responsive Order & Inventory Management System (OMS) built as a Next.js application. It synchronizes warehouse inventory, seller orders, and purchases dynamically in real-time.

---

## 1. Technology Stack
* **Framework:** Next.js (App Router)
* **Frontend Library:** React (TypeScript / TSX)
* **Database & ORM:** MongoDB (Atlas Cloud) via native MongoDB drivers & Mongoose models
* **Styling:** CSS / Tailwind CSS for layout and rich UI elements
* **Icons:** React Icons (`react-icons/fi`)

---

## 2. Codebase Architecture
```
dev-oms/
├── app/                      # Next.js App Router folders
│   ├── api/                  # REST API Route Handlers (REST endpoints)
│   │   ├── seller-orders/    # Create, read, and atomically update seller orders
│   │   ├── stock/            # Query and report inventory balance
│   │   ├── purchase/         # Handle purchases and receipt adjustments
│   │   └── ...               # Vendors, Sellers, Users, Transporters APIs
│   ├── dashboard/            # Protected Dashboard views
│   │   ├── orders/           # Order tracking tables, status boards, partial shipping modals
│   │   ├── purchase/         # Vendor forms, Item creation, and Purchase menus
│   │   ├── stock/            # Live warehouse stock balance and history reports
│   │   └── settings/         # User authorization and permissions panel
│   └── page.tsx              # Main entry / Login redirector
├── components/               # Shared UI elements (Form builders, Modal popups, etc.)
├── models/                   # Mongoose Database schemas
│   ├── Item.ts               # Core item catalog with available stock and audit logs
│   ├── SellerOrder.ts        # Order details, tracking IDs, and statuses
│   └── Vendor.ts, Seller.ts  # Contact profiles
└── lib/                      # Database client connection helpers
```

---

## 3. Core Modules & Features

### A. Dashboard Home (`/dashboard`)
* Serves as the central hub of the application.
* Implements **role-based access control** and permissions checks. Menu actions (Purchase, Stock, Orders, Print Label, Settings) are conditionally rendered depending on the logged-in user's user permissions.

### B. Purchase Module (`/dashboard/purchase`)
* **Purchase Management:** Tracks incoming item orders from manufacturers or wholesale suppliers.
* **Add Vendor:** Allows registering new suppliers, linking them to specific item distributions.
* **Add Item:** Creates new stock items in the system catalog, generating a unique SKU code.

### C. Stock & Inventory Module (`/dashboard/stock`)
* **Live Balance List:** Renders all items currently monitored in the warehouse. Displays available stock units, pending required units (`reQty`), location tags, rates, and cumulative valuations.
* **Stock Audits:** Tracks historical movements (Opening Stock, Purchase Inflows, Purchase Returns, Confirmed Shipments, Returned orders) to guarantee perfect traceability.

### D. Sales & Orders Module (`/dashboard/orders`)
* Visualizes active sales requests in tabbed boards based on execution stage:
  1. `TO CHECK` (Awaiting review / Pending quantity reservation)
  2. `READY TO SHIP` (Confirmed shipment / Stock physically allocated)
  3. `DELIVERY` (In transit / Transporter details loaded)
  4. `FULFILLED` (Delivery finalized / Succeeded)
  5. `HISAB` (Billed and settled)
  6. `CANCELL ORDER` (Aborted transaction)
  7. `RETURN ORDER` (Inbound customer return initiated)
  8. `RETURN RECEIVED` (Return inspected / Stock restored back to available)

---

## 4. Real-Time Inventory & Stock Synchronization
The database preserves data consistency through automated updates on order status transitions:

| Action / Transition | Available Stock (`stock.quantity`) | Pending Required (`stock.reQty`) |
| :--- | :--- | :--- |
| **New Order Created** (Status: `"TO CHECK"`) | *No Change* | **Increases** by order quantity |
| **Full Confirmation** (`"TO CHECK"` $\rightarrow$ `"READY TO SHIP"`) | **Decreases** by order quantity | **Decreases** by order quantity |
| **Partial Shipment** (Splits order quantity) | **Decreases** by shipped quantity | **Decreases** by shipped quantity |
| **Cancellation / Finalization** (`"TO CHECK"` $\rightarrow$ `"CANCEL/HISAB/FULFILLED"`) | *No Change* | **Decreases** by order quantity |
| **Order Cancelled after Shipment** (`"READY TO SHIP"` $\rightarrow$ `"CANCEL/RETURN"`) | **Increases** by order quantity | *No Change* |
| **Return Received** (`"RETURN ORDER"` $\rightarrow$ `"RETURN RECEIVED"`) | **Increases** by return quantity | *No Change* |

---

## 5. Concurrency & Double-Click Protection
To prevent network lag or fast double-clicks from corrupting inventory numbers (e.g., subtracting stock twice), we implemented **Optimistic Concurrency Control (OCC)** at the database level:
* Updates query records conditionally based on their expected state (`status`, `reQty` values).
* If a duplicate request arrives concurrently, the second process fails to find a matching document (since the first request already completed the transition), returns a `409 Conflict`, and aborts immediately before modifying stock collections.
