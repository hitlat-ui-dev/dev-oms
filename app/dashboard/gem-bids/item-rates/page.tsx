"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FiArrowLeft, FiList, FiSearch } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";

interface ItemRateRow {
  source: "ours" | "market";
  itemTitle: string;
  rate: string;
  party: string;
  bidNo: string;
  date: string | null;
  place: string;
  evaluationType: string;
}

// Every rate the OMS knows about for every item, in one searchable/
// filterable place - "ours" (what we quoted, saved every time Bid Rate's
// Fill Rates panel saves, appended rather than overwritten - see
// gem_bid_item_rate_log in boq/save/route.ts) merged with "market" (real
// GeM result L1 data, imported via Bid Rate's "Import Bid Results" - see
// marketRateEngine.ts). The actual data lives in those two existing
// collections; this page (and /api/gem-bids/item-rates) just reads and
// merges them rather than duplicating anything into a third place.
export default function ItemRatesPage() {
  const [rows, setRows] = useState<ItemRateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"" | "ours" | "market">("");

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (sourceFilter) params.set("source", sourceFilter);
    const handle = setTimeout(() => {
      fetch(`/api/gem-bids/item-rates?${params.toString()}`)
        .then((res) => res.json())
        .then((data) => setRows(Array.isArray(data.rows) ? data.rows : []))
        .catch((err) => console.error("Failed to load item rates", err))
        .finally(() => setLoading(false));
    }, 250); // debounced - search re-fetches server-side rather than filtering an already-loaded list
    return () => clearTimeout(handle);
  }, [search, sourceFilter]);

  const itemGroupCount = useMemo(() => new Set(rows.map((r) => r.itemTitle.toLowerCase().trim())).size, [rows]);

  return (
    <BlockGuard
      permission="gemBids"
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
        <div className="max-w-[1400px] mx-auto flex flex-col gap-4">
          <div>
            <Link href="/dashboard/gem-bids" className="flex items-center gap-2 text-slate-500 hover:text-blue-600 text-xs mb-2 transition-colors w-fit">
              <FiArrowLeft /> Back to GeM Bids
            </Link>
            <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
              <FiList className="text-blue-600" /> Central Bid Item Rates
            </h1>
            <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mt-0.5">
              Every Rate We&apos;ve Quoted And Every Imported Market L1 Result, In One Place
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-3 border-b border-slate-100 flex flex-wrap items-end gap-2.5">
              <div className="flex-1 min-w-[220px]">
                <label className="text-[8px] font-black uppercase text-slate-400 tracking-wider block mb-1">Search Item</label>
                <div className="relative">
                  <FiSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" size={12} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="e.g. Angle Gauge, M S Flat..."
                    className="w-full bg-slate-50 border border-slate-200 rounded pl-7 pr-2.5 py-1.5 text-[11px] focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="text-[8px] font-black uppercase text-slate-400 tracking-wider block mb-1">Source</label>
                <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl p-1">
                  {([
                    ["", "All"],
                    ["ours", "Our Rates"],
                    ["market", "Market L1"],
                  ] as const).map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setSourceFilter(val)}
                      className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wide transition-colors ${
                        sourceFilter === val ? "bg-blue-600 text-white shadow" : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="ml-auto text-[10px] text-slate-400 font-bold uppercase">
                {rows.length} row{rows.length === 1 ? "" : "s"} · {itemGroupCount} distinct item{itemGroupCount === 1 ? "" : "s"}
              </div>
            </div>

            {loading ? (
              <div className="flex justify-center items-center py-16">
                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-blue-500"></div>
              </div>
            ) : rows.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-10">
                {search || sourceFilter ? "No rates match this search/filter." : "No rates saved or imported yet."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-black">
                    <tr>
                      <th className="py-2 px-3 text-left">Source</th>
                      <th className="py-2 px-3 text-left">Item Title</th>
                      <th className="py-2 px-3 text-right">Rate</th>
                      <th className="py-2 px-3 text-left">Party</th>
                      <th className="py-2 px-3 text-left">Bid No</th>
                      <th className="py-2 px-3 text-left">Date</th>
                      <th className="py-2 px-3 text-left">Place</th>
                      <th className="py-2 px-3 text-left">Evaluation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td className="py-2 px-3">
                          <span
                            className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                              r.source === "ours" ? "bg-amber-100 text-amber-700" : "bg-purple-100 text-purple-700"
                            }`}
                          >
                            {r.source === "ours" ? "Our Rate" : "Market L1"}
                          </span>
                        </td>
                        <td className="py-2 px-3 font-bold text-slate-700 max-w-[280px] truncate" title={r.itemTitle}>
                          {r.itemTitle}
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-slate-900 whitespace-nowrap">{r.rate}</td>
                        <td className="py-2 px-3 text-slate-500 max-w-[160px] truncate" title={r.party}>
                          {r.party || "—"}
                        </td>
                        <td className="py-2 px-3 text-slate-500 whitespace-nowrap">{r.bidNo || "—"}</td>
                        <td className="py-2 px-3 text-slate-500 whitespace-nowrap">
                          {r.date ? new Date(r.date).toLocaleDateString("en-IN") : "—"}
                        </td>
                        <td className="py-2 px-3 text-slate-500 max-w-[200px] truncate" title={r.place}>
                          {r.place || "—"}
                        </td>
                        <td className="py-2 px-3 text-slate-500 whitespace-nowrap">
                          {r.evaluationType === "ITEM_WISE" ? "Item-wise" : r.evaluationType === "TOTAL" ? "Total" : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </BlockGuard>
  );
}
