# Dev OMS — Order & Inventory Management System

A robust, real-time **Order & Inventory Management System** built with **Next.js 16 (App Router)**. Designed for internal warehouse and sales operations — tracking stock levels, seller orders, purchases, and deliveries from a single dashboard.

---

## 🚀 Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript / TSX |
| Frontend | React 19 |
| Database | MongoDB Atlas (via native `mongodb` driver + Mongoose models) |
| Styling | Tailwind CSS v4 |
| Icons | `react-icons` (Feather Icons) |
| Export | `xlsx` (Excel), `jspdf` + `jspdf-autotable` (PDF), `jszip` |

---

## 📁 Project Structure

```
dev-oms/
├── app/
│   ├── api/                        # REST API Route Handlers
│   │   ├── seller-orders/          # Create & update seller orders (OCC-protected)
│   │   ├── stock/                  # Query live inventory balances
│   │   ├── purchase/               # Record purchases & receipts
│   │   ├── purchase-requests/      # Manage purchase request workflows
│   │   ├── purchase-return/        # Handle stock returns from purchases
│   │   ├── received-purchase/      # Confirm received goods
│   │   ├── orders/                 # General order queries
│   │   ├── items/                  # Item catalog CRUD
│   │   ├── categories/             # Item category management
│   │   ├── sellers/                # Seller profile management
│   │   ├── vendors/                # Vendor/supplier management
│   │   ├── transporters/           # Transporter contact management
│   │   ├── companies/              # Company profile management
│   │   ├── units/                  # Unit of measure management
│   │   ├── users/                  # User account management
│   │   ├── login/                  # Authentication endpoint
│   │   └── backup/                 # Data backup utilities
│   ├── dashboard/
│   │   ├── page.tsx                # Dashboard home (role-gated menu)
│   │   ├── orders/                 # Order tracking boards & status management
│   │   ├── purchase/               # Purchase, Vendor, and Item management views
│   │   ├── stock/                  # Live inventory list & stock history
│   │   ├── print-labels/           # Shipping label generator
│   │   ├── settings/               # User permissions & admin panel
│   │   └── admin/                  # Admin-only controls
│   ├── login/                      # Login page
│   └── page.tsx                    # Root redirect (→ login)
├── components/                     # Shared UI components (modals, forms, guards)
├── models/                         # Mongoose schemas
│   ├── Item.ts                     # Item catalog with stock audit logs
│   ├── SellerOrder.ts              # Order records with status & tracking
│   ├── PurchaseRequest.ts          # Purchase request records
│   ├── ReceivedPurchase.ts         # Goods receipt records
│   ├── Seller.ts / Vendor.ts       # Contact profiles
│   ├── Transporter.ts              # Transporter records
│   ├── Category.ts / Unit.ts       # Lookup tables
│   ├── Company.ts                  # Company records
│   └── User.js                     # User accounts & permissions
└── lib/
    └── mongodb.ts                  # Singleton MongoDB client connection
```

---

## ✨ Core Features

### 🏠 Dashboard Home
- Role-based navigation: menu items (Purchase, Stock, Orders, Print Labels, Settings) are shown or hidden based on the logged-in user's permissions.
- User session managed via `localStorage`.

### 📦 Stock & Inventory Module (`/dashboard/stock`)
- **Live Inventory Table** — real-time stock levels with SKU, item name, category, location, required qty (`reQty`), available qty, last rate, and total valuation.
- **Multi-column search** — filter simultaneously by SKU, item name, and category.
- **Excel Export** — one-click download of the filtered stock list via `xlsx`.
- **Role-sensitive columns** — rate and total value columns are only visible to authorized users.
- **Live Reload** — refresh stock data without a full page reload.
- **Item Report Modal** — click any item to view full stock movement history.

### 🛒 Orders Module (`/dashboard/orders`)
Orders move through a defined pipeline of statuses:

| Status | Description |
|---|---|
| `TO CHECK` | Awaiting review / Pending quantity reservation |
| `READY TO SHIP` | Stock confirmed & physically allocated |
| `DELIVERY` | In transit — transporter details loaded |
| `FULFILLED` | Delivery finalized & completed |
| `HISAB` | Billed and settled |
| `CANCEL ORDER` | Transaction aborted |
| `RETURN ORDER` | Customer return initiated |
| `RETURN RECEIVED` | Return inspected & stock restored |

- **Partial Shipment (Split Orders)** — when shipping less than the full order qty, a child order is automatically created (e.g., `ORD-001-P1`) for the remaining quantity.

### 🏭 Purchase Module (`/dashboard/purchase`)
- Record new purchases from vendors.
- Register new vendors/suppliers.
- Add new stock items with auto-generated SKU codes.

### 🖨️ Print Labels (`/dashboard/print-labels`)
- Generate and download shipping labels as PDF using `jspdf`.

### 🔗 GeM Links Module (`/dashboard/gem-sync`)
- **Requirement Mapping Console** — upload client requirement sheets and map items directly to live warehouse stock.
- **Auto-Fill Details** — auto-fills pricing, firm codes, stock counts, and GeM URLs on item mapping selection.
- **Multi-Sheet Library** — store and resume mapping worksheets directly from MongoDB database state.
- **Master Mapped List** — view visually consolidated mapped configurations grouped by item name.

### ⚙️ Settings & Admin (`/dashboard/settings`, `/dashboard/admin`)
- Manage user accounts and their module-level permissions (including the new `GeM Links` access control).

---

## 🔄 Real-Time Stock Synchronization

Stock levels are automatically adjusted on every order status transition:

| Transition | `stock.quantity` (Available) | `stock.reQty` (Pending) |
|:---|:---|:---|
| New order created (`TO CHECK`) | No change | ➕ Increases by order qty |
| Full confirmation (`TO CHECK` → `READY TO SHIP`) | ➖ Decreases by order qty | ➖ Decreases by order qty |
| Partial shipment (split) | ➖ Decreases by shipped qty | ➖ Decreases by shipped qty |
| Cancelled from `TO CHECK` | No change | ➖ Decreases by order qty |
| Cancelled after shipment (`READY TO SHIP` → `CANCEL/RETURN`) | ➕ Increases by order qty | No change |
| Return received (`RETURN ORDER` → `RETURN RECEIVED`) | ➕ Increases by return qty | No change |

---

## 🔒 Concurrency & Double-Click Protection

To prevent race conditions (e.g., double-clicking a status button that would subtract stock twice), the system implements **Optimistic Concurrency Control (OCC)**:

- API updates query documents conditionally based on their **current expected state** (`status`, `reQty`).
- If a second concurrent request arrives after the first has already committed, it finds no matching document and returns a **`409 Conflict`** — aborting without any stock mutation.

---

## 🛠️ Local Development Setup

### Prerequisites
- Node.js 18+
- A MongoDB Atlas account (or use the dev clone cluster)

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment

Create a `.env.local` file in the project root:

```env
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/<dbname>?appName=<appName>
```

> **For local development**, always use a cloned/dev MongoDB Atlas cluster to avoid modifying production data. The current dev cluster is `clone-dev-oms-project`.

### 3. Run the Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📦 Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start development server with hot-reload |
| `npm run build` | Build production bundle |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |

---

## 🗄️ Database

- **Provider:** MongoDB Atlas (Cloud)
- **Dev Cluster:** `clone-dev-oms-project` — isolated clone, safe for development
- **Production Cluster:** Separate Atlas cluster — never point `.env.local` at production
- **Connection:** Singleton `MongoClient` with hot-reload-safe global caching in development mode (see `lib/mongodb.ts`)

---

## 📄 Additional Documentation

- For detailed version history and features, see [`CHANGELOG.md`](./CHANGELOG.md).
- For detailed module logic, stock synchronization rules, and API behaviour, see [`system_documentation.md`](./system_documentation.md).
