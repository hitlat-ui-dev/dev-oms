"use client";
import { useEffect, useMemo, useState } from "react";
import { FiSearch } from "react-icons/fi";

interface TagRow {
  tag_key: string;
  tag_name: string;
  count: number;
  brands: string[];
  lowest: number | null;
  offers: { supplier: string; brand: string; rate: number; source?: string }[];
}

const inr = (n: number | null) => (typeof n === "number" ? n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");

// Quick-lookup popup body (navbar > Pricelist): one search bar; matching tagged items are listed below
// with brand and lowest incl.-GST rate. Read-only - renaming / merging / deleting tags stays on the Tag Manager page.
export default function PricelistLookupPanel() {
  const [tags, setTags] = useState<TagRow[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/purchase/pricelist/tags/summary?include=received")
      .then((r) => r.json())
      .then((d) => setTags(Array.isArray(d.tags) ? d.tags : []))
      .catch(() => setError("Could not load tagged items"));
  }, []);

  // every typed word must appear in the tag name or one of its brands (case-insensitive)
  const results = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!tags || words.length === 0) return [];
    return tags
      .filter((t) => {
        const hay = `${t.tag_name} ${t.brands.join(" ")}`.toLowerCase();
        return words.every((w) => hay.includes(w) || t.offers.some((o) => o.supplier.toLowerCase().includes(w)));
      })
      .slice(0, 100);
  }, [tags, q]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <FiSearch className="absolute left-3 top-3 text-slate-400" />
        <input
          autoFocus
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tagged item or brand…"
          className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
        />
      </div>

      {error && <div className="text-xs text-rose-600">{error}</div>}
      {!error && tags === null && <div className="text-xs text-slate-400 animate-pulse">Loading…</div>}
      {tags !== null && !q.trim() && <div className="text-xs text-slate-400 text-center py-6">Type to search {tags.length} tagged items</div>}
      {tags !== null && q.trim() && results.length === 0 && <div className="text-xs text-slate-400 text-center py-6">No tagged item found</div>}

      {results.length > 0 && (
        <div className="max-h-[55vh] overflow-y-auto flex flex-col gap-2">
          {results.map((t) => (
            <div key={t.tag_key} className="border border-slate-200 rounded-xl overflow-hidden bg-white">
              <div className="px-3 py-2 bg-slate-50 text-xs font-black text-slate-800">{t.tag_name}</div>
              {t.offers.length === 0 && <div className="px-3 py-2 text-[11px] text-slate-400">No active rate</div>}
              <div className="divide-y divide-slate-100">
                {t.offers.map((o, i) => (
                  <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-1.5 text-xs items-center">
                    <span className="font-bold text-slate-700">{o.supplier || "—"}</span>
                    <span className="w-28 text-slate-500">{o.source === "received" ? <span className="text-green-600 font-bold">Received</span> : o.brand || "—"}</span>
                    <span className={"w-24 text-right font-black " + (o.source === "received" ? "text-green-600" : i === t.offers.findIndex((x) => x.source !== "received") ? "text-orange-600" : "text-slate-700")}>₹{inr(o.rate)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
