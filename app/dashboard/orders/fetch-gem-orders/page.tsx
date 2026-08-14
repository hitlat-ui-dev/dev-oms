"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  FiArrowLeft,
  FiCheckCircle,
  FiTrash2,
  FiExternalLink,
  FiRefreshCw,
  FiSearch,
  FiBriefcase,
  FiInfo,
  FiClock,
  FiCheck,
  FiAlertCircle
} from "react-icons/fi";

interface RawGeMOrder {
  _id: string;
  contractNo: string;
  contractDate: string;
  contractUrl: string;
  buyerDesignation?: string;
  department?: string;
  location?: string;
  instituteName: string;
  itemName: string;
  qty: number;
  rate: number;
  totalAmount: number;
  firmCode?: string;
  gemStatus?: string;
  status: string;
  createdAt: string;
}

interface BuyerOption {
  id: string;
  name: string;
  gemLocationText?: string;
}

interface UploadedSheetRow {
  originalName: string;
  qty: number;
  rate: number;
  gemLink?: string;
  mappedItemId?: string;
}

interface SheetRecord {
  id: string;
  fileName: string;
  selectedBuyerId: string;
  uploadedRows: UploadedSheetRow[];
}

interface StockItemOption {
  _id: string;
  sku: string;
  itemName: string;
  category: string;
  unit: string;
}

export default function FetchGeMOrdersPage() {
  const router = useRouter();

  const [rawOrders, setRawOrders] = useState<RawGeMOrder[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [buyerOptions, setBuyerOptions] = useState<BuyerOption[]>([]);
  const [sheets, setSheets] = useState<SheetRecord[]>([]);
  const [stockItems, setStockItems] = useState<StockItemOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Verification modal state
  const [selectedOrder, setSelectedOrder] = useState<RawGeMOrder | null>(null);
  const [selectedFirmCode, setSelectedFirmCode] = useState("");
  const [customInstituteName, setCustomInstituteName] = useState("");
  const [customItemName, setCustomItemName] = useState("");
  const [itemQuery, setItemQuery] = useState("");
  const [showItemSuggestions, setShowItemSuggestions] = useState(false);
  const [selectedStockItem, setSelectedStockItem] = useState<StockItemOption | null>(null);
  const [customQty, setCustomQty] = useState<number>(1);
  const [customRate, setCustomRate] = useState<number>(0);
  const [customRemark, setCustomRemark] = useState("");
  const [autoFillHint, setAutoFillHint] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [currentUsername, setCurrentUsername] = useState("");

  useEffect(() => {
    try {
      const stored = localStorage.getItem("oms_user");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.username) setCurrentUsername(parsed.username);
      }
    } catch (err) {
      console.error("Failed to read logged-in user", err);
    }
  }, []);

  useEffect(() => {
    fetchRawOrders();
    fetchCompanies();
    fetchSheetsAndBuyers();
    fetchStockItems();
  }, []);

  // Resolve the Sheet Library file(s) tied to a given buyer (matches by
  // buyer id or name, same dual-check the GeM Sync Console uses since
  // selectedBuyerId sometimes holds a name instead of an id).
  const resolveBuyerSheets = (buyerName: string) => {
    const buyerQ = buyerName.trim().toLowerCase();
    if (!buyerQ) return [];
    const matchedBuyer = buyerOptions.find(b => b.name.trim().toLowerCase() === buyerQ);
    return sheets.filter(s => {
      const sel = (s.selectedBuyerId || "").trim().toLowerCase();
      return sel === buyerQ || (matchedBuyer && sel === matchedBuyer.id.trim().toLowerCase());
    });
  };

  // Sheet Library auto-match: once Buyer (Institute) is picked, find the row
  // in that buyer's uploaded rate sheet whose Rate/Qty matches what the order
  // actually placed on GeM at (the buyer ordered at the quoted rate/qty), then
  // pull the real stock item (via that row's mappedItemId) and the item name
  // as originally written in the buyer's Excel sheet (into Remark) from it.
  useEffect(() => {
    if (!customInstituteName.trim() || !selectedOrder) {
      setAutoFillHint(null);
      return;
    }

    const candidateSheets = resolveBuyerSheets(customInstituteName);
    const orderRate = Number(selectedOrder.rate);
    const orderQty = Number(selectedOrder.qty);

    let rateOnlyMatch: { row: UploadedSheetRow; sheet: SheetRecord } | null = null;

    outer: for (const sheet of candidateSheets) {
      for (const row of sheet.uploadedRows || []) {
        if (Number(row.rate) !== orderRate) continue;
        if (Number(row.qty) === orderQty) {
          rateOnlyMatch = { row, sheet };
          break outer; // exact rate+qty match - best case, stop here
        }
        if (!rateOnlyMatch) rateOnlyMatch = { row, sheet };
      }
    }

    if (!rateOnlyMatch) {
      setAutoFillHint(null);
      return;
    }

    const { row, sheet } = rateOnlyMatch;
    const stockItem = row.mappedItemId ? stockItems.find(s => s._id === row.mappedItemId) : null;
    if (stockItem) {
      setSelectedStockItem(stockItem);
      setCustomItemName(stockItem.itemName);
      setItemQuery(stockItem.itemName);
    }
    if (row.originalName) setCustomRemark(row.originalName);
    setAutoFillHint(`Auto-matched from Sheet Library "${sheet.fileName}" (rate ₹${row.rate}, qty ${row.qty})`);
  }, [customInstituteName, selectedOrder, sheets, buyerOptions, stockItems]);

  const fetchRawOrders = async () => {
    try {
      setRefreshing(true);
      const res = await fetch(`/api/gem-orders?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        setRawOrders(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("Error fetching raw GeM orders:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchCompanies = async () => {
    try {
      const res = await fetch(`/api/companies?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        setCompanies(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("Error fetching companies:", err);
    }
  };

  // Buyers/ITIs + Sheet Library, for the Buyer field suggestions and the
  // Rate/Qty auto-fill in the verify modal (same source the GeM Sync Console uses).
  const fetchSheetsAndBuyers = async () => {
    try {
      const [gemSyncRes, sellersRes] = await Promise.all([
        fetch(`/api/gem-sync?t=${Date.now()}`),
        fetch(`/api/sellers?t=${Date.now()}`).catch(() => null)
      ]);

      const merged = new Map<string, BuyerOption>();

      if (gemSyncRes.ok) {
        const data = await gemSyncRes.json();
        setSheets(Array.isArray(data.sheets) ? data.sheets : []);
        (data.buyers || []).forEach((b: any) => {
          const name = (b.name || "").trim();
          if (name) merged.set(name.toLowerCase(), { id: b.id, name });
        });
      }

      if (sellersRes && sellersRes.ok) {
        const sellers = await sellersRes.json();
        (Array.isArray(sellers) ? sellers : []).forEach((s: any) => {
          const name = (s.instituteName || s.buyerName || s.name || "").trim();
          const gemLocationText = (s.gemLocationText || "").trim();
          if (name) {
            // Sellers take priority over gem_buyers for the same name, since
            // only sellers carry gemLocationText (used to auto-match below).
            merged.set(name.toLowerCase(), { id: s._id || name, name, gemLocationText });
          }
        });
      }

      setBuyerOptions(Array.from(merged.values()));
    } catch (err) {
      console.error("Error fetching buyers/sheets:", err);
    }
  };

  const fetchStockItems = async () => {
    try {
      const res = await fetch(`/api/stock?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        setStockItems(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("Error fetching stock items:", err);
    }
  };

  const handleDelete = async (id: string, contractNo: string) => {
    if (!confirm(`Are you sure you want to delete/reject order ${contractNo}?`)) return;

    try {
      const res = await fetch(`/api/gem-orders/${id}`, { method: "DELETE" });
      if (res.ok) {
        setRawOrders(prev => prev.filter(o => o._id !== id));
      } else {
        const err = await res.json();
        alert(err.error || "Failed to delete order");
      }
    } catch (err) {
      alert("Error deleting order");
    }
  };

  const openVerifyModal = (order: RawGeMOrder) => {
    setSelectedOrder(order);
    const firmMatch = order.firmCode && companies.some(c => c.firmCode === order.firmCode);
    setSelectedFirmCode(firmMatch ? order.firmCode! : (companies.length > 0 ? companies[0].firmCode : "GeM"));
    // Try to pre-select a matching Institute from the Seller Directory.
    // Prefer the dedicated "GeM Location" field (an exact/near-exact copy of
    // GeM's own Location text, set once per seller in Add Seller) since it's
    // far more reliable than guessing off the institute name alone - only
    // fall back to a name-based substring guess if no seller has that set.
    const rawLoc = (order.instituteName || order.location || "").toLowerCase();
    const guessedBuyer =
      buyerOptions.find((b) => {
        const gemLoc = (b.gemLocationText || "").toLowerCase();
        return gemLoc && (rawLoc.includes(gemLoc) || gemLoc.includes(rawLoc));
      }) ||
      buyerOptions.find(
        (b) => b.name && (rawLoc.includes(b.name.toLowerCase()) || b.name.toLowerCase().includes(rawLoc))
      );
    setCustomInstituteName(guessedBuyer ? guessedBuyer.name : "");
    setCustomItemName(order.itemName);
    setItemQuery(order.itemName || "");
    setSelectedStockItem(null);
    setShowItemSuggestions(false);
    setCustomQty(order.qty || 1);
    setCustomRate(order.rate || 0);
    // Left blank until (if) the Sheet Library auto-match below fills it in
    // with the item name from the buyer's own Excel sheet - no location text.
    setCustomRemark("");
    setAutoFillHint(null);
  };

  const handleSelectStockItem = (item: StockItemOption) => {
    setSelectedStockItem(item);
    setCustomItemName(item.itemName);
    setItemQuery(item.itemName);
    setShowItemSuggestions(false);
  };

  const itemSuggestions = useMemo(() => {
    const q = itemQuery.toLowerCase().trim();
    const pool = q ? stockItems.filter(s => s.itemName.toLowerCase().includes(q)) : stockItems;
    return pool.slice(0, 8);
  }, [itemQuery, stockItems]);

  const handleVerifySubmit = async () => {
    if (!selectedOrder) return;
    setVerifying(true);

    try {
      const res = await fetch(`/api/gem-orders/${selectedOrder._id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firmCode: selectedFirmCode,
          instituteName: customInstituteName,
          itemId: selectedStockItem?._id,
          itemName: customItemName,
          category: selectedStockItem?.category,
          unit: selectedStockItem?.unit,
          sku: selectedStockItem?.sku,
          qty: customQty,
          rate: customRate,
          totalAmount: customQty * customRate,
          remark: customRemark,
          createdBy: currentUsername,
        })
      });

      if (res.ok) {
        const result = await res.json();
        alert(`✅ Order Verified Successfully! Saved to Main Orders as ${result.orderNo}`);
        setRawOrders(prev => prev.filter(o => o._id !== selectedOrder._id));
        setSelectedOrder(null);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to verify order");
      }
    } catch (err) {
      alert("System error verifying order");
    } finally {
      setVerifying(false);
    }
  };

  const filteredOrders = useMemo(() => {
    if (!searchQuery.trim()) return rawOrders;
    const q = searchQuery.toLowerCase().trim();
    return rawOrders.filter(o =>
      (o.contractNo || "").toLowerCase().includes(q) ||
      (o.instituteName || "").toLowerCase().includes(q) ||
      (o.itemName || "").toLowerCase().includes(q) ||
      (o.location || "").toLowerCase().includes(q)
    );
  }, [rawOrders, searchQuery]);

  return (
    <div className="p-4 md:p-10 max-w-7xl mx-auto font-sans">
      {/* Top Header Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <button
          onClick={() => router.push("/dashboard/orders")}
          className="flex items-center gap-2 text-slate-500 hover:text-blue-600 font-bold text-xs uppercase tracking-widest transition-colors"
        >
          <FiArrowLeft size={16} /> Back to Orders Dashboard
        </button>
        <button
          onClick={fetchRawOrders}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs uppercase tracking-wider transition-colors disabled:opacity-50"
        >
          <FiRefreshCw className={refreshing ? "animate-spin" : ""} size={14} /> Refresh
        </button>
      </div>

      {/* Page Title */}
      <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white p-6 md:p-8 rounded-2xl shadow-xl mb-8">
        <div className="flex items-center gap-3 text-amber-400 text-xs font-black uppercase tracking-[0.25em] mb-2">
          <FiClock size={16} /> Extension Staging Verification
        </div>
        <h1 className="text-3xl font-black uppercase tracking-tight">Fetched GeM Orders</h1>
        <p className="text-slate-300 text-xs font-medium mt-2 max-w-2xl">
          Review, verify and approve raw orders fetched from the GeM Chrome Extension before moving them into your Main Sales Orders.
        </p>
      </div>

      {/* Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-6">
        <div className="relative flex-1 min-w-[260px]">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search contract no, buyer, or item name..."
            className="w-full pl-10 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 font-medium"
          />
        </div>
        <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
          Total Pending: <span className="text-blue-600 font-black">{filteredOrders.length}</span>
        </div>
      </div>

      {/* Orders List */}
      {loading ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200 shadow-sm">
          <FiRefreshCw className="animate-spin text-blue-600 mx-auto mb-3" size={28} />
          <p className="text-slate-500 font-bold text-sm">Loading fetched orders...</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200 shadow-sm">
          <FiAlertCircle className="text-slate-400 mx-auto mb-3" size={36} />
          <h3 className="text-lg font-black text-slate-700 uppercase">No Pending GeM Orders</h3>
          <p className="text-slate-400 text-xs mt-1">
            Fetch orders using the Chrome Extension on GeM marketplace to verify them here.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse min-w-[900px]">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-black uppercase tracking-wider border-b border-slate-200">
                <th className="px-3 py-3">Firm</th>
                <th className="px-3 py-3">Buyer</th>
                <th className="px-3 py-3">Cat.</th>
                <th className="px-3 py-3">Item Details</th>
                <th className="px-3 py-3">Contract</th>
                <th className="px-3 py-3 text-center">O-Qty</th>
                <th className="px-3 py-3 text-right">Rate</th>
                <th className="px-3 py-3 text-right">Total</th>
                <th className="px-3 py-3 text-center">Status</th>
                <th className="px-3 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredOrders.map((order) => (
                <tr key={order._id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-3 py-3 font-black text-slate-700">{order.firmCode || "—"}</td>
                  <td className="px-3 py-3 max-w-56">
                    <div className="font-bold text-slate-800 truncate">{order.instituteName}</div>
                  </td>
                  <td className="px-3 py-3 text-slate-400">—</td>
                  <td className="px-3 py-3 max-w-72">
                    <div className="font-bold text-slate-900 truncate">{order.itemName}</div>
                  </td>
                  <td className="px-3 py-3">
                    <a
                      href={order.contractUrl || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-blue-600 hover:text-blue-800 font-bold"
                    >
                      {order.contractNo}
                      {order.contractUrl && <FiExternalLink size={11} />}
                    </a>
                    {order.contractDate && <div className="text-[10px] text-slate-400 font-semibold">{order.contractDate}</div>}
                  </td>
                  <td className="px-3 py-3 text-center font-bold text-slate-900">{order.qty} nos</td>
                  <td className="px-3 py-3 text-right font-bold text-slate-900">₹{order.rate}</td>
                  <td className="px-3 py-3 text-right font-black text-emerald-700">₹{order.totalAmount}</td>
                  <td className="px-3 py-3 text-center">
                    <span className="bg-amber-100 text-amber-800 text-[10px] font-black tracking-wider px-2.5 py-1 rounded-full uppercase">
                      UNVERIFIED
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => openVerifyModal(order)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[10px] uppercase tracking-wider transition-all"
                      >
                        <FiCheckCircle size={13} /> Verify
                      </button>
                      <button
                        onClick={() => handleDelete(order._id, order.contractNo)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Reject Order"
                      >
                        <FiTrash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Verification Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden border border-slate-100">
            <div className="bg-slate-900 text-white p-6">
              <h3 className="text-lg font-black uppercase tracking-tight">Verify GeM Order</h3>
              <p className="text-slate-400 text-xs font-medium mt-1">
                Contract: {selectedOrder.contractNo}
              </p>
            </div>

            <div className="p-6 space-y-4 text-xs font-medium">
              <div>
                <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1">
                  Assign Firm (Company)
                </label>
                <select
                  value={selectedFirmCode}
                  onChange={(e) => setSelectedFirmCode(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-bold focus:outline-none focus:border-blue-500"
                >
                  {companies.length > 0 ? (
                    companies.map(c => (
                      <option key={c._id} value={c.firmCode}>{c.firmName} ({c.firmCode})</option>
                    ))
                  ) : (
                    <option value="GeM">GeM Marketplace</option>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1">
                  Buyer / Institute
                </label>
                <select
                  value={customInstituteName}
                  onChange={(e) => setCustomInstituteName(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-semibold focus:outline-none focus:border-blue-500"
                >
                  <option value="">-- Select Institute --</option>
                  {buyerOptions.map((b) => (
                    <option key={b.id} value={b.name}>{b.name}</option>
                  ))}
                </select>
                {!customInstituteName && (
                  <p className="text-[10px] text-amber-600 font-semibold mt-1">
                    GeM se aaya raw text: "{selectedOrder?.instituteName}" - upar se sahi institute chuno.
                  </p>
                )}
              </div>

              <div className="relative">
                <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1">
                  Item Name {selectedStockItem && <span className="text-emerald-600 normal-case font-semibold">(SKU: {selectedStockItem.sku})</span>}
                </label>
                <input
                  type="text"
                  value={itemQuery}
                  onChange={(e) => {
                    setItemQuery(e.target.value);
                    setCustomItemName(e.target.value);
                    setSelectedStockItem(null);
                    setShowItemSuggestions(true);
                  }}
                  onFocus={() => setShowItemSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowItemSuggestions(false), 150)}
                  placeholder="Search stock item..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-semibold focus:outline-none focus:border-blue-500"
                />
                {!selectedStockItem && (
                  <p className="text-[10px] text-amber-600 font-semibold mt-1">
                    Pick a real stock item below so Stock/Re-Qty shows correctly on the Main Orders page.
                  </p>
                )}
                {autoFillHint && (
                  <p className="text-[10px] text-emerald-600 font-bold mt-1">✓ {autoFillHint}</p>
                )}
                {showItemSuggestions && itemSuggestions.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
                    {itemSuggestions.map((item) => (
                      <button
                        type="button"
                        key={item._id}
                        onMouseDown={() => handleSelectStockItem(item)}
                        className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-slate-50 last:border-0"
                      >
                        <div className="font-bold text-slate-800">{item.itemName}</div>
                        <div className="text-[10px] text-slate-400">SKU: {item.sku} · {item.category}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1">
                    Quantity
                  </label>
                  <input
                    type="number"
                    value={customQty}
                    onChange={(e) => setCustomQty(Number(e.target.value))}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-semibold focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1">
                    Rate (₹)
                  </label>
                  <input
                    type="number"
                    value={customRate}
                    onChange={(e) => setCustomRate(Number(e.target.value))}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-semibold focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1">
                  Total Amount (₹)
                </label>
                <div className="p-2.5 bg-emerald-50 text-emerald-800 font-black rounded-lg text-sm">
                  ₹{customQty * customRate}
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1">
                  Remark / Note
                </label>
                <input
                  type="text"
                  value={customRemark}
                  onChange={(e) => setCustomRemark(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-black font-semibold focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="p-6 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3">
              <button
                onClick={() => setSelectedOrder(null)}
                disabled={verifying}
                className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-bold uppercase text-xs tracking-wider transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleVerifySubmit}
                disabled={verifying}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold uppercase text-xs tracking-wider transition-all shadow-md"
              >
                {verifying ? "Verifying..." : "Approve & Move Order"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
