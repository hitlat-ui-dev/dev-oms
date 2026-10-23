"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FiSearch, FiCalendar, FiUser, FiTag, FiDownload, FiRefreshCw, FiPlus, FiX } from "react-icons/fi";
import * as XLSX from "xlsx";
import ReceivedTagDialog from "@/components/purchase/pricelist/ReceivedTagDialog";

// Read-only copy of the Received Purchase view for the Pricelist module: qty/rate are plain text and the
// original data is never written. The only write is tagging an item with a bid item name
// (/api/purchase/pricelist/received-tags), stored separately.
// Rate/Total visibility follows the original tab's rule (hidden for users flagged receivePurchaseRate).

const money = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const labelCls = "text-[10px] font-black uppercase text-slate-400 mb-1.5 block px-1";
const inputCls = "w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-orange-500";

export default function ReceivedPurchaseReadOnly({ user }: { user: { username: string; isAdmin: boolean } }) {
  const [rows, setRows] = useState<any[]>([]);
  const [tagTarget, setTagTarget] = useState<{ itemName: string; sku: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterDate, setFilterDate] = useState("");
  const [filterItem, setFilterItem] = useState("");
  const [filterVendor, setFilterVendor] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [limit, setLimit] = useState(50);
  const [canSeeRate, setCanSeeRate] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem("oms_user");
    const u = raw ? JSON.parse(raw) : null;
    const name = u?.username?.trim().toLowerCase();
    const superAdmin = ["chintan", "hitesh"].includes(name) || u?.permissions?.boss === true;
    setCanSeeRate(superAdmin || u?.permissions?.receivePurchaseRate !== true);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/purchase/pricelist/received-with-tags");
      const data = await res.json();
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setLimit(50), [filterDate, filterItem, filterVendor, filterCategory]);

  const filtered = useMemo(() => {
    const q = filterItem.toLowerCase();
    return rows
      .filter((r) => {
        const dateOk = !filterDate || new Date(r.receivedAt).toLocaleDateString("en-CA") === filterDate;
        const itemOk = !q || r.itemName?.toLowerCase().includes(q) || r.sku?.toLowerCase().includes(q);
        const vendorOk = (r.vendor || "").toLowerCase().includes(filterVendor.toLowerCase());
        const catOk = (r.category || "").toLowerCase().includes(filterCategory.toLowerCase());
        return dateOk && itemOk && vendorOk && catOk;
      })
      .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
  }, [rows, filterDate, filterItem, filterVendor, filterCategory]);

  const exportExcel = () => {
    if (filtered.length === 0) return alert("No data to export");
    const data = filtered.map((r) => ({
      "Order ID": r.orderNo || r.orderNumber || "N/A",
      Date: new Date(r.receivedAt || r.createdAt).toLocaleDateString(),
      "Item Name": r.itemName,
      SKU: r.sku || "N/A",
      Vendor: r.vendor,
      Category: r.category || "General",
      Tags: (r.tags || []).map((t: any) => t.tag_name).join(", "),
      "Rec Qty": r.receivedQty || 0,
      ...(canSeeRate ? { Rate: r.rate || 0 } : {}),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Received Orders");
    XLSX.writeFile(wb, "Received_Orders_Report.xlsx");
  };

  const th = "py-4 px-4 text-[10px] font-black uppercase text-slate-400";
  const removeTag = async (id: string) => {
    if (!confirm("Remove this tag?")) return;
    await fetch(`/api/purchase/pricelist/received-tags?id=${id}`, { method: "DELETE" });
    load();
  };
  const chip = (t: { _id: string; tag_key: string; tag_name: string }) => (
    <span key={t._id} className="inline-flex items-center gap-1 bg-green-50 text-green-700 border border-green-200 rounded-full pl-2 pr-1.5 py-0.5 text-[10px] font-bold">
      {t.tag_name}
      {user.isAdmin && <button onClick={() => removeTag(t._id)} className="hover:text-rose-600" title="Remove tag"><FiX size={10} /></button>}
    </span>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end flex-wrap gap-2">
        <button onClick={load} className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-[11px] font-black uppercase flex items-center gap-2">
          <FiRefreshCw className={loading ? "animate-spin" : ""} /> Refresh
        </button>
        <button onClick={exportExcel} className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-[11px] font-black uppercase flex items-center gap-2">
          <FiDownload /> Excel Report
        </button>
      </div>

      {(
        <>
          <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className={labelCls}>Date</label>
              <div className="relative"><FiCalendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="date" className={inputCls} value={filterDate} onChange={(e) => setFilterDate(e.target.value)} /></div>
            </div>
            <div>
              <label className={labelCls}>Item / SKU</label>
              <div className="relative"><FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" placeholder="Search item..." className={inputCls} value={filterItem} onChange={(e) => setFilterItem(e.target.value)} /></div>
            </div>
            <div>
              <label className={labelCls}>Vendor</label>
              <div className="relative"><FiUser className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" placeholder="Vendor name..." className={inputCls} value={filterVendor} onChange={(e) => setFilterVendor(e.target.value)} /></div>
            </div>
            <div>
              <label className={labelCls}>Category</label>
              <div className="relative"><FiTag className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" placeholder="Category..." className={inputCls} value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} /></div>
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50/80 border-b border-slate-100">
                  <tr>
                    <th className={th}>Order ID</th><th className={th}>Date</th><th className={th}>Item Details</th>
                    <th className={th}>Category</th><th className={th}>Tags</th><th className={th}>Vendor</th>
                    <th className={`${th} text-center`}>Rec. Qty</th><th className={`${th} text-center`}>Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {loading ? (
                    <tr><td colSpan={8} className="py-20 text-center font-bold text-slate-400 animate-pulse uppercase tracking-widest text-xs">Loading Received Purchase Data...</td></tr>
                  ) : (
                    filtered.slice(0, limit).map((r) => (
                      <tr key={r._id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-4 font-black text-blue-600 text-xs">{r.orderNumber || "---"}</td>
                        <td className="py-3 px-4 text-[11px] font-bold text-slate-500">{new Date(r.receivedAt).toLocaleDateString("en-GB")}</td>
                        <td className="py-3 px-4">
                          <div className="flex flex-col">
                            <span className="text-[9px] font-bold text-blue-500 mb-0.5">{r.sku || "N/A"}</span>
                            <span className="font-black text-slate-800 text-xs uppercase">{r.itemName}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-[10px] font-bold text-slate-400 uppercase">{r.category || "General"}</td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1 items-center">
                            {(r.tags || []).map(chip)}
                            {r.sku && (
                              <button onClick={() => setTagTarget({ itemName: r.itemName, sku: r.sku })} className="inline-flex items-center gap-0.5 text-[10px] font-bold text-blue-600 hover:underline">
                                <FiPlus size={10} /> Tag
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-[10px] font-black text-slate-600 uppercase">{r.vendor}</td>
                        <td className="py-3 px-4 text-center text-xs font-black text-blue-700">{r.receivedQty}</td>
                        <td className="py-3 px-4 text-center text-xs font-black text-green-700">{canSeeRate ? money(Number(r.rate || 0)) : <span className="text-slate-400">NA</span>}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              {filtered.length > limit && (
                <div className="flex justify-center p-6 bg-slate-50 border-t border-slate-100">
                  <button onClick={() => setLimit((p) => p + 50)} className="px-6 py-2.5 bg-orange-500 text-white font-black text-xs uppercase tracking-widest rounded-xl">
                    Load More ({filtered.length - limit} Remaining)
                  </button>
                </div>
              )}
              {filtered.length === 0 && !loading && (
                <div className="p-10 text-center text-slate-400 font-bold uppercase text-[10px] tracking-widest">No matching records found</div>
              )}
            </div>
          </div>
        </>
      )}
      {tagTarget && (
        <ReceivedTagDialog
          itemName={tagTarget.itemName}
          skus={[tagTarget.sku]}
          userName={user.username}
          onClose={() => setTagTarget(null)}
          onDone={() => {
            setTagTarget(null);
            load();
          }}
        />
      )}
    </div>
  );
}
