"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { FiArrowLeft, FiList, FiSearch, FiX, FiPlus } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";

interface MarketSample {
  rate: number;
  party: string;
  date: string | null;
  place: string;
  evaluationType: string;
  bidNo: string;
}

interface ItemRow {
  itemKey: string;
  itemTitle: string;
  ourRate: string;
  ourBidNo: string;
  ourDate: string | null;
  marketRate: string;
  marketSampleCount: number;
  marketSamples: MarketSample[];
  alternateNames: string[];
  preferredRate: string;
  remarks: string;
  pricelistRate: string;
  pricelistSupplier: string;
}

// One row per distinct item, pulling together our own quoted rates (see
// gem_bid_item_rate_log), imported GeM market L1 results (see
// gem_bid_item_market_rate_history), the item-master's alternate
// names/preferred rate/remarks (see gem_bid_item_master, edited inline here
// via /api/gem-bids/item-master), and a Pricelist rate suggestion matched
// by item-name similarity against Purchase > Pricelist's own catalogue -
// see /api/gem-bids/item-rates for how all four are merged server-side.
export default function ItemRatesPage() {
  const [rows, setRows] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchRows = () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    return fetch(`/api/gem-bids/item-rates?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => setRows(Array.isArray(data.rows) ? data.rows : []))
      .catch((err) => console.error("Failed to load item rates", err));
  };

  useEffect(() => {
    setLoading(true);
    const handle = setTimeout(() => {
      fetchRows().finally(() => setLoading(false));
    }, 250); // debounced - search re-fetches server-side rather than filtering an already-loaded list
    return () => clearTimeout(handle);
  }, [search]);

  const saveField = async (row: ItemRow, field: "alternateNames" | "preferredRate" | "remarks", value: any) => {
    // Optimistic - the whole row list gets re-synced from the server on
    // next search/reload anyway, this just avoids a round-trip flicker.
    setRows((prev) => prev.map((r) => (r.itemKey === row.itemKey ? { ...r, [field]: value } : r)));
    try {
      await fetch("/api/gem-bids/item-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemKey: row.itemKey, itemTitle: row.itemTitle, field, value }),
      });
    } catch (err) {
      console.error("Failed to save item-master field", err);
    }
  };

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
        <div className="max-w-[1500px] mx-auto flex flex-col gap-4">
          <div>
            <Link href="/dashboard/gem-bids" className="flex items-center gap-2 text-slate-500 hover:text-blue-600 text-xs mb-2 transition-colors w-fit">
              <FiArrowLeft /> Back to GeM Bids
            </Link>
            <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
              <FiList className="text-blue-600" /> Central Bid Item Rates
            </h1>
            <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mt-0.5">
              Every Item We&apos;ve Ever Quoted - Our Rate, Market L1 History, Pricelist Rate, And Your Own Notes, In One Place
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
                    placeholder="e.g. Angle Gauge, M S Flat... (also matches alternate names)"
                    className="w-full bg-slate-50 border border-slate-200 rounded pl-7 pr-2.5 py-1.5 text-[11px] focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div className="ml-auto text-[10px] text-slate-400 font-bold uppercase">
                {rows.length} item{rows.length === 1 ? "" : "s"}
              </div>
            </div>

            {loading ? (
              <div className="flex justify-center items-center py-16">
                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-blue-500"></div>
              </div>
            ) : rows.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-10">{search ? "No items match this search." : "No rates saved or imported yet."}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-black">
                    <tr>
                      <th className="py-2 px-3 text-left">Item Name</th>
                      <th className="py-2 px-3 text-right">Our Rate</th>
                      <th className="py-2 px-3 text-left">Alternate / Similar Names</th>
                      <th className="py-2 px-3 text-right">Market L1 Rate</th>
                      <th className="py-2 px-3 text-right">Preferred Rate</th>
                      <th className="py-2 px-3 text-left">Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r) => (
                      <ItemRowView key={r.itemKey} row={r} onSave={saveField} />
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

function ItemRowView({
  row,
  onSave,
}: {
  row: ItemRow;
  onSave: (row: ItemRow, field: "alternateNames" | "preferredRate" | "remarks", value: any) => void;
}) {
  const [addingAlt, setAddingAlt] = useState(false);
  const [altInput, setAltInput] = useState("");
  const [preferredInput, setPreferredInput] = useState(row.preferredRate);
  const [remarksInput, setRemarksInput] = useState(row.remarks);
  const altInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setPreferredInput(row.preferredRate), [row.preferredRate]);
  useEffect(() => setRemarksInput(row.remarks), [row.remarks]);

  const addAlternateName = () => {
    const value = altInput.trim();
    if (value && !row.alternateNames.some((a) => a.toLowerCase() === value.toLowerCase())) {
      onSave(row, "alternateNames", [...row.alternateNames, value]);
    }
    setAltInput("");
    setAddingAlt(false);
  };

  const removeAlternateName = (name: string) => {
    onSave(row, "alternateNames", row.alternateNames.filter((a) => a !== name));
  };

  return (
    <tr>
      <td className="py-2 px-3 font-bold text-slate-700 max-w-[220px] truncate align-top" title={row.itemTitle}>
        {row.itemTitle}
      </td>
      <td className="py-2 px-3 text-right align-top whitespace-nowrap">
        <div className="font-bold text-slate-900">{row.ourRate || "—"}</div>
        {row.ourBidNo && <div className="text-[9px] text-slate-400">{row.ourBidNo}</div>}
      </td>
      <td className="py-2 px-3 align-top min-w-[200px]">
        <div className="flex flex-wrap gap-1 items-center">
          {row.alternateNames.map((name) => (
            <span key={name} className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 text-[10px]">
              {name}
              <button type="button" onClick={() => removeAlternateName(name)} className="text-slate-400 hover:text-red-500">
                <FiX size={10} />
              </button>
            </span>
          ))}
          {addingAlt ? (
            <input
              ref={altInputRef}
              autoFocus
              value={altInput}
              onChange={(e) => setAltInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addAlternateName();
                if (e.key === "Escape") {
                  setAltInput("");
                  setAddingAlt(false);
                }
              }}
              onBlur={addAlternateName}
              placeholder="alias name"
              className="w-24 bg-white border border-blue-300 rounded px-1.5 py-0.5 text-[10px] focus:outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => setAddingAlt(true)}
              className="inline-flex items-center gap-0.5 text-[9px] text-blue-600 font-bold uppercase hover:underline"
            >
              <FiPlus size={9} /> Add
            </button>
          )}
        </div>
      </td>
      <td className="py-2 px-3 text-right align-top whitespace-nowrap">
        <MarketRateCell row={row} />
        {row.pricelistRate && (
          <div className="text-[9px] text-emerald-700 font-bold mt-0.5" title={row.pricelistSupplier ? `Supplier: ${row.pricelistSupplier}` : ""}>
            Pricelist: {row.pricelistRate}
          </div>
        )}
      </td>
      <td className="py-2 px-3 text-right align-top whitespace-nowrap">
        <input
          value={preferredInput}
          onChange={(e) => setPreferredInput(e.target.value)}
          onBlur={() => {
            if (preferredInput !== row.preferredRate) onSave(row, "preferredRate", preferredInput);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="—"
          className="w-20 text-right bg-slate-50 border border-slate-200 rounded px-1.5 py-1 text-[11px] focus:outline-none focus:border-blue-500"
        />
      </td>
      <td className="py-2 px-3 align-top min-w-[160px]">
        <input
          value={remarksInput}
          onChange={(e) => setRemarksInput(e.target.value)}
          onBlur={() => {
            if (remarksInput !== row.remarks) onSave(row, "remarks", remarksInput);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="—"
          className="w-full bg-slate-50 border border-slate-200 rounded px-1.5 py-1 text-[11px] focus:outline-none focus:border-blue-500"
        />
      </td>
    </tr>
  );
}

// Headline = most recent result; hover reveals the up-to-5-row trend table
// behind it - same pattern as GemBidTable.tsx/document-maker's own copy.
function MarketRateCell({ row }: { row: ItemRow }) {
  if (!row.marketRate) return <span className="text-slate-300">—</span>;
  return (
    <div className="relative inline-block group/market">
      <span className="text-purple-700 font-bold block">
        {row.marketRate}
        {row.marketSampleCount > 1 ? <span className="text-[9px] text-purple-400"> ({row.marketSampleCount})</span> : null}
      </span>
      {row.marketSamples.length > 0 && (
        <div className="hidden group-hover/market:block absolute z-50 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl p-2 w-max max-w-sm text-left">
          <table className="text-[9px] border-collapse">
            <thead>
              <tr className="text-slate-400 font-black uppercase">
                <th className="text-left pr-3 pb-1">Rate</th>
                <th className="text-left pr-3 pb-1">L1 Party</th>
                <th className="text-left pr-3 pb-1">Date</th>
                <th className="text-left pr-3 pb-1">Place</th>
                <th className="text-left pb-1">Eval</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {row.marketSamples.map((s, i) => (
                <tr key={i} className={i === 0 ? "font-bold text-slate-800" : "text-slate-500"}>
                  <td className="pr-3 py-0.5 whitespace-nowrap">{s.rate}</td>
                  <td className="pr-3 py-0.5 max-w-[110px] truncate" title={s.party}>
                    {s.party || "—"}
                  </td>
                  <td className="pr-3 py-0.5 whitespace-nowrap">{s.date ? new Date(s.date).toLocaleDateString("en-IN") : "—"}</td>
                  <td className="pr-3 py-0.5 max-w-[140px] truncate" title={s.place}>
                    {s.place || "—"}
                  </td>
                  <td className="py-0.5 whitespace-nowrap">
                    {s.evaluationType === "ITEM_WISE" ? "Item-wise" : s.evaluationType === "TOTAL" ? "Total" : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
