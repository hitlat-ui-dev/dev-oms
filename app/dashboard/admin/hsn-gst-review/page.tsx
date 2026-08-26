"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { FiArrowLeft, FiHash, FiCheckCircle, FiSave, FiRefreshCw, FiSearch } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";

interface StockItem {
  _id: string;
  sku: string;
  itemName: string;
  category: string;
  unit: string;
  hidden: boolean;
  hsnSac: string;
  gstPercent: number;
  hsnGstConfirmed: boolean;
}

const PAGE_SIZE = 50;

export default function HsnGstReviewPage() {
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "unconfirmed" | "confirmed">("unconfirmed");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editValues, setEditValues] = useState<Record<string, { hsnSac: string; gstPercent: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [toast, setToast] = useState("");

  const fetchItems = useCallback(() => {
    setLoading(true);
    fetch("/api/stock")
      .then((res) => res.json())
      .then((data) => setItems(Array.isArray(data) ? data.filter((i: StockItem) => !i.hidden) : []))
      .catch((err) => console.error("Failed to load stock", err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const categories = useMemo(
    () => [...new Set(items.map((i) => i.category).filter(Boolean))].sort(),
    [items]
  );

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((i) => {
      if (categoryFilter && i.category !== categoryFilter) return false;
      if (statusFilter === "unconfirmed" && i.hsnGstConfirmed) return false;
      if (statusFilter === "confirmed" && !i.hsnGstConfirmed) return false;
      if (q && !i.itemName.toLowerCase().includes(q) && !i.sku.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, categoryFilter, statusFilter, searchQuery]);

  const visible = filtered.slice(0, visibleCount);

  const confirmedCount = useMemo(() => items.filter((i) => i.hsnGstConfirmed).length, [items]);

  const getValue = (item: StockItem, field: "hsnSac" | "gstPercent") => {
    const edit = editValues[item._id];
    if (edit) return edit[field];
    return field === "hsnSac" ? item.hsnSac || "" : String(item.gstPercent ?? 0);
  };

  const setValue = (id: string, field: "hsnSac" | "gstPercent", value: string) => {
    setEditValues((prev) => ({
      ...prev,
      [id]: {
        hsnSac: field === "hsnSac" ? value : prev[id]?.hsnSac ?? items.find((i) => i._id === id)?.hsnSac ?? "",
        gstPercent:
          field === "gstPercent" ? value : prev[id]?.gstPercent ?? String(items.find((i) => i._id === id)?.gstPercent ?? 0),
      },
    }));
  };

  const hasUnsavedEdit = (id: string) => editValues[id] !== undefined;

  const handleSaveRow = async (item: StockItem) => {
    const edit = editValues[item._id];
    if (!edit) return;
    setSavingId(item._id);
    try {
      const res = await fetch(`/api/items/${item._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hsnSac: edit.hsnSac.trim(),
          gstPercent: edit.gstPercent === "" ? 0 : Number(edit.gstPercent),
          hsnGstConfirmed: true,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
      setItems((prev) =>
        prev.map((i) =>
          i._id === item._id
            ? { ...i, hsnSac: edit.hsnSac.trim(), gstPercent: edit.gstPercent === "" ? 0 : Number(edit.gstPercent), hsnGstConfirmed: true }
            : i
        )
      );
      setEditValues((prev) => {
        const next = { ...prev };
        delete next[item._id];
        return next;
      });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(item._id);
        return next;
      });
    } catch (err: any) {
      alert(err.message || "Failed to save");
    } finally {
      setSavingId(null);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    const visibleIds = visible.map((i) => i._id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const handleBulkConfirm = async () => {
    if (selectedIds.size === 0 || bulkConfirming) return;
    setBulkConfirming(true);
    try {
      const res = await fetch("/api/items/bulk-confirm-hsn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stockIds: [...selectedIds] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to confirm");
      setItems((prev) => prev.map((i) => (selectedIds.has(i._id) ? { ...i, hsnGstConfirmed: true } : i)));
      setToast(`Confirmed ${selectedIds.size} item(s).`);
      setSelectedIds(new Set());
      setTimeout(() => setToast(""), 3000);
    } catch (err: any) {
      alert(err.message || "Failed to confirm");
    } finally {
      setBulkConfirming(false);
    }
  };

  return (
    <BlockGuard
      permission="stock"
      fallback={
        <div className="flex flex-col items-center gap-2 m-4 p-4 border border-red-200 rounded-xl bg-red-50 text-center">
          <p className="text-red-500 font-bold uppercase">You have no Access for this Page.</p>
          <Link href="/dashboard" className="text-sm bg-slate-900 text-white px-4 py-2 mt-4 rounded-lg hover:bg-slate-800 transition-all">
            Go to Dashboard
          </Link>
        </div>
      }
    >
      <div className="p-4 md:p-8 bg-slate-50 min-h-screen">
        <div className="max-w-6xl mx-auto flex flex-col gap-6">
          <div>
            <Link href="/dashboard" className="flex items-center gap-2 text-slate-500 hover:text-blue-600 text-xs mb-2 transition-colors w-fit">
              <FiArrowLeft /> Back to Dashboard
            </Link>
            <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
              <FiHash className="text-violet-600" /> HSN &amp; GST Review
            </h1>
            <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mt-0.5">
              Confirm each item&apos;s HSN/SAC + GST% at your own pace - unconfirmed values are drafts, not yet verified
            </p>
          </div>

          {/* Progress */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-black text-slate-700 uppercase tracking-wide">Overall Progress</span>
              <span className="text-xs font-black text-violet-700">
                {confirmedCount} / {items.length} confirmed
              </span>
            </div>
            <div className="bg-slate-100 rounded-full h-2.5 overflow-hidden">
              <div
                className="h-full bg-violet-600 rounded-full transition-all"
                style={{ width: `${items.length ? Math.max(2, (confirmedCount / items.length) * 100) : 0}%` }}
              />
            </div>
          </div>

          {toast && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 text-emerald-800 text-xs font-bold">
              <FiCheckCircle size={14} /> {toast}
            </div>
          )}

          {/* Filters */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setVisibleCount(PAGE_SIZE); }}
                placeholder="Search item name / SKU..."
                className="w-full pl-9 pr-3 py-2 text-xs font-bold border border-slate-200 rounded-lg outline-none focus:border-violet-400"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => { setCategoryFilter(e.target.value); setVisibleCount(PAGE_SIZE); }}
              className="bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs font-bold text-slate-700 outline-none focus:border-violet-400"
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <div className="flex items-center gap-1.5 bg-slate-100 rounded-xl p-1">
              {(["unconfirmed", "confirmed", "all"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => { setStatusFilter(s); setVisibleCount(PAGE_SIZE); }}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide transition-colors ${
                    statusFilter === s ? "bg-white text-violet-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <button
              onClick={fetchItems}
              className="p-2 text-slate-400 hover:text-violet-600 transition-colors"
              title="Refresh"
            >
              <FiRefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>

          {/* Table */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
              <span className="text-xs font-black text-slate-700 uppercase">
                {filtered.length} item{filtered.length === 1 ? "" : "s"} match this filter
              </span>
              {selectedIds.size > 0 && (
                <button
                  onClick={handleBulkConfirm}
                  disabled={bulkConfirming}
                  className="flex items-center gap-2 bg-violet-600 text-white font-black uppercase text-[11px] tracking-wider px-4 py-2 rounded-xl transition-all hover:bg-violet-700 active:scale-[0.98] disabled:opacity-50"
                >
                  <FiCheckCircle size={13} />
                  {bulkConfirming ? "Confirming..." : `Mark Selected Confirmed (${selectedIds.size})`}
                </button>
              )}
            </div>

            {loading ? (
              <p className="text-xs font-bold text-slate-400 p-8 text-center">Loading...</p>
            ) : filtered.length === 0 ? (
              <p className="text-xs font-bold text-slate-400 p-8 text-center">No items match this filter.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-slate-400 uppercase text-[10px] tracking-wide bg-slate-50">
                      <th className="p-3 w-8">
                        <input
                          type="checkbox"
                          checked={visible.length > 0 && visible.every((i) => selectedIds.has(i._id))}
                          onChange={toggleSelectAllVisible}
                          className="w-3.5 h-3.5"
                        />
                      </th>
                      <th className="p-3">Item Name</th>
                      <th className="p-3">SKU</th>
                      <th className="p-3">Category</th>
                      <th className="p-3">HSN/SAC</th>
                      <th className="p-3">GST %</th>
                      <th className="p-3">Status</th>
                      <th className="p-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visible.map((item) => (
                      <tr key={item._id} className={hasUnsavedEdit(item._id) ? "bg-amber-50/50" : ""}>
                        <td className="p-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(item._id)}
                            onChange={() => toggleSelect(item._id)}
                            className="w-3.5 h-3.5"
                          />
                        </td>
                        <td className="p-3 font-bold text-slate-800">{item.itemName}</td>
                        <td className="p-3 font-mono text-slate-500">{item.sku}</td>
                        <td className="p-3 text-slate-500">{item.category}</td>
                        <td className="p-3">
                          <input
                            type="text"
                            value={getValue(item, "hsnSac")}
                            onChange={(e) => setValue(item._id, "hsnSac", e.target.value)}
                            placeholder="e.g. 84713000"
                            className="w-28 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-mono text-xs outline-none focus:border-violet-400"
                          />
                        </td>
                        <td className="p-3">
                          <input
                            type="number"
                            value={getValue(item, "gstPercent")}
                            onChange={(e) => setValue(item._id, "gstPercent", e.target.value)}
                            className="w-16 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-mono text-xs outline-none focus:border-violet-400"
                          />
                        </td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                              item.hsnGstConfirmed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {item.hsnGstConfirmed ? "Confirmed" : "Not Confirmed"}
                          </span>
                        </td>
                        <td className="p-3">
                          {hasUnsavedEdit(item._id) && (
                            <button
                              onClick={() => handleSaveRow(item)}
                              disabled={savingId === item._id}
                              className="flex items-center gap-1.5 bg-emerald-600 text-white font-black uppercase text-[10px] tracking-wide px-3 py-1.5 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                            >
                              <FiSave size={11} /> {savingId === item._id ? "Saving..." : "Save & Confirm"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {filtered.length > visible.length && (
              <button
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="w-full text-[11px] font-black uppercase tracking-widest text-violet-600 hover:text-violet-700 bg-violet-50 border-t border-violet-100 py-3"
              >
                Load {PAGE_SIZE} More ({filtered.length - visible.length} remaining)
              </button>
            )}
          </div>
        </div>
      </div>
    </BlockGuard>
  );
}
