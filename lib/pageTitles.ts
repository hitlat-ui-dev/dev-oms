// Maps a dashboard route to a short browser-tab title, so multiple OMS tabs
// open side by side (Orders, Purchase, GeM Fetch, ...) are distinguishable
// in Chrome's tab strip instead of all showing the same URL-derived text.
const EXACT_TITLES: Record<string, string> = {
  "/login": "Login",
  "/dashboard": "Dashboard",
  "/dashboard/orders": "Orders Hub",
  "/dashboard/orders/orders": "Orders",
  "/dashboard/orders/add-order": "Add Order",
  "/dashboard/orders/fetch-gem-orders": "GeM Fetch",
  "/dashboard/orders/companies": "Companies",
  "/dashboard/orders/add-seller": "Add Seller",
  "/dashboard/orders/add-transporter": "Add Transporter",
  "/dashboard/purchase": "Purchase Hub",
  "/dashboard/purchase/purchase": "Purchase",
  "/dashboard/purchase/purchase-request": "Purchase Request",
  "/dashboard/purchase/add-item": "Add Item",
  "/dashboard/purchase/add-vendor": "Add Vendor",
  "/dashboard/stock": "Stock",
  "/dashboard/stock/items": "Items",
  "/dashboard/account": "Account",
  "/dashboard/account/ledger": "Ledger",
  "/dashboard/account/reconciliation": "Reconciliation",
  "/dashboard/account/statement": "Statement",
  "/dashboard/account/buyer-ledger": "Buyer Ledger",
  "/dashboard/gem-bids": "GeM Bids",
  "/dashboard/gem-bids/document-maker": "Bid Document Maker",
  "/dashboard/gem-sync": "GeM Sync",
  "/dashboard/gem-sync/catalogue": "GeM Catalogue",
  "/dashboard/print-labels": "Print Labels",
  "/dashboard/summary": "Summary",
  "/dashboard/todo-chat": "Chat",
  "/dashboard/settings": "Settings",
  "/dashboard/admin/backup": "Backup",
};

// Longest-prefix match for routes not listed exactly above (e.g. a future
// dynamic sub-page) so they still get a sensible title instead of falling
// through to the generic default.
const PREFIX_TITLES: [string, string][] = [
  ["/dashboard/orders", "Orders"],
  ["/dashboard/purchase", "Purchase"],
  ["/dashboard/stock", "Stock"],
  ["/dashboard/account", "Account"],
  ["/dashboard/gem-bids", "GeM Bids"],
  ["/dashboard/gem-sync", "GeM Sync"],
];

export function getPageTitle(pathname: string): string {
  const exact = EXACT_TITLES[pathname];
  if (exact) return `${exact} · Dev OMS`;

  const prefixMatch = PREFIX_TITLES
    .filter(([prefix]) => pathname.startsWith(prefix))
    .sort((a, b) => b[0].length - a[0].length)[0];
  if (prefixMatch) return `${prefixMatch[1]} · Dev OMS`;

  return "Dev OMS";
}
