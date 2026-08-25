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
  FiAlertCircle,
  FiChevronUp,
  FiChevronDown,
  FiZap,
  FiX
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
  variantGroup?: string;
  variantLabel?: string;
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
  const [showFetchHistory, setShowFetchHistory] = useState(false);
  const [fetchHistory, setFetchHistory] = useState<{ firmCode: string; firmName: string; lastFetchedAt: string | null }[]>([]);
  const [loadingFetchHistory, setLoadingFetchHistory] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortConfig, setSortConfig] = useState<{ key: "firmCode" | "instituteName" | "itemName"; direction: "asc" | "desc" } | null>(null);

  // Verification modal state
  const [selectedOrder, setSelectedOrder] = useState<RawGeMOrder | null>(null);
  const [selectedFirmCode, setSelectedFirmCode] = useState("");
  const [customInstituteName, setCustomInstituteName] = useState("");
  const [customItemName, setCustomItemName] = useState("");
  const [itemQuery, setItemQuery] = useState("");
  const [showItemSuggestions, setShowItemSuggestions] = useState(false);
  const [selectedStockItem, setSelectedStockItem] = useState<StockItemOption | null>(null);
  // Populated when the picked item belongs to a variant group (e.g. "White
  // Board Marker" Green/Red/Blue/Black) - each sibling is its own SKU with
  // its own stock, this just lets the user switch to the right one by label.
  const [variantSiblings, setVariantSiblings] = useState<StockItemOption[]>([]);
  const [customQty, setCustomQty] = useState<number>(1);
  const [customRate, setCustomRate] = useState<number>(0);
  const [customRemark, setCustomRemark] = useState("");
  const [autoFillHint, setAutoFillHint] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [currentUsername, setCurrentUsername] = useState("");

  // Sheet Library auto-match results, keyed by raw order id - only populated
  // when the "Auto-Match Items" button below is clicked (never runs on its
  // own), then reused to pre-fill the Verify modal when it's opened.
  const [matchResults, setMatchResults] = useState<Record<string, { instituteName?: string; itemId?: string; itemName?: string; remark?: string; hint?: string }>>({});
  const [matchingAll, setMatchingAll] = useState(false);

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

  // Sheet Library match lookup: given a buyer and an order, find the row in
  // that buyer's uploaded rate sheet whose Rate/Qty matches what the order
  // actually placed on GeM at (the buyer ordered at the quoted rate/qty).
  // /api/gem-sync's bulk response never carries uploadedRows (moved to R2,
  // loaded lazily per-sheet - see route.ts) so each candidate sheet's rows
  // are fetched on demand here via ?sheetContent=, through sheetRowsCache so
  // the same sheet is never re-fetched twice in one bulk run. Only ever
  // called from runBulkAutoMatch below (the "Auto-Match Items" button),
  // never on its own, so Institute/Item Name/Remark never silently change
  // under the user.
  const findSheetMatch = async (
    buyerName: string,
    order: RawGeMOrder,
    sheetRowsCache: Map<string, UploadedSheetRow[]>
  ): Promise<{ row: UploadedSheetRow; sheet: SheetRecord } | null> => {
    const candidateSheets = resolveBuyerSheets(buyerName);
    const orderRate = Number(order.rate);
    const orderQty = Number(order.qty);

    let rateOnlyMatch: { row: UploadedSheetRow; sheet: SheetRecord } | null = null;

    outer: for (const sheet of candidateSheets) {
      let rows = sheetRowsCache.get(sheet.id);
      if (!rows) {
        try {
          const res = await fetch(`/api/gem-sync?sheetContent=${sheet.id}`);
          rows = res.ok ? ((await res.json()).uploadedRows || []) : [];
        } catch {
          rows = [];
        }
        sheetRowsCache.set(sheet.id, rows);
      }

      for (const row of rows) {
        if (Number(row.rate) !== orderRate) continue;
        if (Number(row.qty) === orderQty) {
          rateOnlyMatch = { row, sheet };
          break outer; // exact rate+qty match - best case, stop here
        }
        if (!rateOnlyMatch) rateOnlyMatch = { row, sheet };
      }
    }

    return rateOnlyMatch;
  };

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

  const openFetchHistory = async () => {
    setShowFetchHistory(true);
    setLoadingFetchHistory(true);
    try {
      const res = await fetch(`/api/gem-orders/fetch-history?t=${Date.now()}`);
      const data = await res.json();
      setFetchHistory(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Error fetching GeM order fetch history:", err);
    } finally {
      setLoadingFetchHistory(false);
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

  // Same "does the Seller Directory already have a matching institute"
  // guess used to pre-select the Verify modal's dropdown - also used in the
  // list itself so a match is visible before ever opening Verify.
  const guessBuyerForOrder = (order: RawGeMOrder): BuyerOption | null => {
    const rawLoc = (order.instituteName || order.location || "").toLowerCase();
    if (!rawLoc) return null;
    return (
      buyerOptions.find((b) => {
        const gemLoc = (b.gemLocationText || "").toLowerCase();
        return gemLoc && (rawLoc.includes(gemLoc) || gemLoc.includes(rawLoc));
      }) ||
      buyerOptions.find(
        (b) => b.name && (rawLoc.includes(b.name.toLowerCase()) || b.name.toLowerCase().includes(rawLoc))
      ) ||
      null
    );
  };

  // Bulk "Auto-Match Items" button (top of page) - the only trigger for the
  // Institute + Sheet Library rate/qty matching. Runs once across every
  // pending order and caches results in matchResults, keyed by order id;
  // openVerifyModal reads from that cache instead of computing it itself.
  const runBulkAutoMatch = async () => {
    setMatchingAll(true);
    try {
      const sheetRowsCache = new Map<string, UploadedSheetRow[]>();
      const results: typeof matchResults = {};
      for (const order of rawOrders) {
        const guessedBuyer = guessBuyerForOrder(order);
        if (!guessedBuyer) continue;

        const match = await findSheetMatch(guessedBuyer.name, order, sheetRowsCache);
        if (!match) continue;

        const { row, sheet } = match;
        const stockItem = row.mappedItemId ? stockItems.find(s => s._id === row.mappedItemId) : null;

        results[order._id] = {
          instituteName: guessedBuyer.name,
          itemId: stockItem?._id,
          itemName: stockItem?.itemName,
          remark: row.originalName || "",
          hint: `Auto-matched from Sheet Library "${sheet.fileName}" (rate ₹${row.rate}, qty ${row.qty})`
        };
      }
      setMatchResults(results);
      const matchedCount = Object.keys(results).length;
      alert(`✓ ${matchedCount} of ${rawOrders.length} orders auto-matched from Sheet Library. Open Verify on a matched order to see it filled in.`);
    } finally {
      setMatchingAll(false);
    }
  };

  const handleSort = (key: "firmCode" | "instituteName" | "itemName") => {
    setSortConfig((prev) => {
      if (prev && prev.key === key) {
        return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { key, direction: "asc" };
    });
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

    // Pre-fill only from the cached "Auto-Match Items" result (if that button
    // was run for this order) or the simple Institute name guess - never runs
    // the Sheet Library rate/qty match itself here.
    const match = matchResults[order._id];
    const guessedBuyer = guessBuyerForOrder(order);
    setCustomInstituteName(match?.instituteName || (guessedBuyer ? guessedBuyer.name : ""));

    const matchedStockItem = match?.itemId ? stockItems.find(s => s._id === match.itemId) : null;
    if (matchedStockItem) {
      setSelectedStockItem(matchedStockItem);
      setCustomItemName(matchedStockItem.itemName);
      setItemQuery(matchedStockItem.itemName);
      setVariantSiblings(
        matchedStockItem.variantGroup
          ? stockItems.filter((s) => s.variantGroup === matchedStockItem.variantGroup)
          : []
      );
    } else {
      setSelectedStockItem(null);
      setCustomItemName(order.itemName);
      setItemQuery(order.itemName || "");
      setVariantSiblings([]);
    }
    setShowItemSuggestions(false);
    setCustomQty(order.qty || 1);
    setCustomRate(order.rate || 0);
    setCustomRemark(match?.remark || "");
    setAutoFillHint(match?.hint || null);
  };

  const handleSelectStockItem = (item: StockItemOption) => {
    setSelectedStockItem(item);
    setCustomItemName(item.itemName);
    setItemQuery(item.itemName);
    setShowItemSuggestions(false);
    // If this item has color/size siblings, offer them below - matched on
    // variantGroup (a real shared field), never on name, since a hidden
    // duplicate can share the exact same itemName as its active replacement.
    setVariantSiblings(
      item.variantGroup
        ? stockItems.filter((s) => s.variantGroup === item.variantGroup)
        : []
    );
  };

  const itemSuggestions = useMemo(() => {
    const q = itemQuery.toLowerCase().trim();
    const pool = q ? stockItems.filter(s => s.itemName.toLowerCase().includes(q)) : stockItems;
    return pool.slice(0, 8);
  }, [itemQuery, stockItems]);

  const handleVerifySubmit = async () => {
    if (!selectedOrder) return;

    // Institute must come from the dropdown (Seller Directory) and item must
    // come from the stock suggestions below the search box — the raw text
    // GeM's page scraped in (order.instituteName / order.itemName) is never
    // allowed to fall through into a saved order unconfirmed.
    if (!customInstituteName.trim()) {
      alert("Buyer / Institute list se select karo — GeM se aaya raw text seedha order me save nahi ho sakta.");
      return;
    }
    if (!selectedStockItem) {
      alert("Item Name ke suggestions me se ek real stock item select karo — GeM se aaya raw item name seedha order me save nahi ho sakta.");
      return;
    }

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

  const sortedOrders = useMemo(() => {
    if (!sortConfig) return filteredOrders;
    const items = [...filteredOrders];
    items.sort((a, b) => {
      const valA = (a[sortConfig.key] || "").toString().toLowerCase();
      const valB = (b[sortConfig.key] || "").toString().toLowerCase();
      if (valA < valB) return sortConfig.direction === "asc" ? -1 : 1;
      if (valA > valB) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return items;
  }, [filteredOrders, sortConfig]);

  const SortHeader = ({ label, sortKey }: { label: string; sortKey: "firmCode" | "instituteName" | "itemName" }) => (
    <th
      onClick={() => handleSort(sortKey)}
      className="px-3 py-3 cursor-pointer select-none hover:text-blue-600 transition-colors"
    >
      <div className="flex items-center gap-1">
        {label}
        {sortConfig?.key === sortKey ? (
          sortConfig.direction === "asc" ? <FiChevronUp size={12} /> : <FiChevronDown size={12} />
        ) : (
          <FiChevronUp size={12} className="opacity-20" />
        )}
      </div>
    </th>
  );

  return (
    <div className="p-4 md:p-10 max-w-[1600px] mx-auto font-sans">
      {/* Top Header Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <button
          onClick={() => router.push("/dashboard/orders")}
          className="flex items-center gap-2 text-slate-500 hover:text-blue-600 font-bold text-xs uppercase tracking-widest transition-colors"
        >
          <FiArrowLeft size={16} /> Back to Orders Dashboard
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={openFetchHistory}
            title="Har firm ke GeM orders last kab fetch hue the"
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs uppercase tracking-wider transition-colors"
          >
            <FiClock size={14} /> History
          </button>
          <button
            onClick={runBulkAutoMatch}
            disabled={matchingAll || rawOrders.length === 0}
            title="Match Institute + Item from the Sheet Library for all pending orders below"
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-colors disabled:opacity-50"
          >
            <FiZap className={matchingAll ? "animate-pulse" : ""} size={14} /> {matchingAll ? "Matching..." : "Auto-Match Items"}
          </button>
          <button
            onClick={fetchRawOrders}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs uppercase tracking-wider transition-colors disabled:opacity-50"
          >
            <FiRefreshCw className={refreshing ? "animate-spin" : ""} size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Page Title */}
      <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white px-4 py-3 md:px-5 md:py-3.5 rounded-xl shadow-md mb-5 flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="flex items-center gap-2 text-amber-400 text-[10px] font-black uppercase tracking-[0.2em]">
          <FiClock size={13} /> Staging
        </div>
        <h1 className="text-base md:text-lg font-black uppercase tracking-tight">Fetched GeM Orders</h1>
        <p className="text-slate-300 text-[11px] font-medium">
          Review, verify and approve raw orders before moving them into Main Sales Orders.
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
                <SortHeader label="Firm" sortKey="firmCode" />
                <SortHeader label="Buyer" sortKey="instituteName" />
                <th className="px-3 py-3">Cat.</th>
                <SortHeader label="Item Details" sortKey="itemName" />
                <th className="px-3 py-3">Contract</th>
                <th className="px-3 py-3 text-center">O-Qty</th>
                <th className="px-3 py-3 text-right">Rate</th>
                <th className="px-3 py-3 text-right">Total</th>
                <th className="px-3 py-3 text-center">Status</th>
                <th className="px-3 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedOrders.map((order) => {
                const matchedBuyer = guessBuyerForOrder(order);
                return (
                <tr key={order._id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-3 py-3 font-black text-slate-700">{order.firmCode || "—"}</td>
                  <td className="px-3 py-3 max-w-56">
                    <div className="font-bold text-slate-800 truncate" title={order.instituteName}>{order.instituteName}</div>
                    {matchedBuyer ? (
                      <div className="flex items-center gap-1 text-[10px] text-emerald-600 font-bold truncate" title={matchedBuyer.name}>
                        <FiCheck size={11} /> {matchedBuyer.name}
                      </div>
                    ) : (
                      <div className="text-[10px] text-amber-600 font-semibold">No match</div>
                    )}
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
                );
              })}
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
                  className={`w-full p-2.5 bg-slate-50 border rounded-lg text-slate-800 font-semibold focus:outline-none ${customInstituteName ? "border-slate-200 focus:border-blue-500" : "border-red-400 focus:border-red-500"}`}
                >
                  <option value="">-- Select Institute --</option>
                  {buyerOptions.map((b) => (
                    <option key={b.id} value={b.name}>{b.name}</option>
                  ))}
                </select>
                {!customInstituteName && (
                  <p className="text-[10px] text-red-600 font-semibold mt-1">
                    GeM se aaya raw text: "{selectedOrder?.instituteName}" - upar se sahi institute chuno (required).
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
                  className={`w-full p-2.5 bg-slate-50 border rounded-lg text-slate-800 font-semibold focus:outline-none ${selectedStockItem ? "border-slate-200 focus:border-blue-500" : "border-red-400 focus:border-red-500"}`}
                />
                {!selectedStockItem && (
                  <p className="text-[10px] text-red-600 font-semibold mt-1">
                    Suggestions me se ek real stock item select karo (required) — GeM ka raw naam seedha save nahi hoga.
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

                {variantSiblings.length > 1 && (
                  <div className="mt-2">
                    <label className="block text-slate-700 font-bold uppercase tracking-wider mb-1">Variant</label>
                    <select
                      value={selectedStockItem?._id || ""}
                      onChange={(e) => {
                        const chosen = variantSiblings.find((v) => v._id === e.target.value);
                        if (chosen) handleSelectStockItem(chosen);
                      }}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-semibold focus:outline-none focus:border-blue-500"
                    >
                      {variantSiblings.map((v) => (
                        <option key={v._id} value={v._id}>{v.variantLabel || v.sku}</option>
                      ))}
                    </select>
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

      {showFetchHistory && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-6 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <h2 className="font-black uppercase tracking-tight">Fetch History</h2>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Firm-wise last fetch date &amp; time</p>
              </div>
              <button onClick={() => setShowFetchHistory(false)} className="text-white/50 hover:text-white transition-colors">
                <FiX size={20} />
              </button>
            </div>

            <div className="overflow-y-auto p-4 space-y-2">
              {loadingFetchHistory ? (
                <p className="text-xs font-bold text-slate-400 text-center py-8">Loading...</p>
              ) : fetchHistory.length === 0 ? (
                <p className="text-xs font-bold text-slate-400 text-center py-8">No firms found.</p>
              ) : (
                fetchHistory.map((f) => (
                  <div key={f.firmCode} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-xl">
                    <div>
                      <p className="font-black text-slate-700 text-sm">{f.firmName}</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{f.firmCode}</p>
                    </div>
                    {f.lastFetchedAt ? (
                      <div className="text-right">
                        <p className="text-xs font-bold text-slate-700">{new Date(f.lastFetchedAt).toLocaleDateString("en-GB")}</p>
                        <p className="text-[10px] font-bold text-slate-400">{new Date(f.lastFetchedAt).toLocaleTimeString("en-GB")}</p>
                      </div>
                    ) : (
                      <span className="text-[10px] font-black uppercase tracking-widest text-red-400">Never Fetched</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
