"use client";
import { useState, useMemo } from "react";
import { FiChevronUp, FiChevronDown, FiCornerUpLeft } from "react-icons/fi";
import { BID_COLUMNS, SECTIONS, SectionKey } from "@/lib/gemBids/columns";

export interface GemBid {
  _id: string;
  bidNo: string;
  tag: "Old" | "New Published" | "Updated/Extended";
  isHighlighted: boolean;
  currentSection: SectionKey;
  hasPendingUpdate: boolean;
  [key: string]: any;
}

interface Props {
  bids: GemBid[];
  currentUsername: string;
  onMoved: () => void;
  onViewHistory: (bidNo: string) => void;
}

const TAG_STYLES: Record<string, string> = {
  "New Published": "bg-blue-50 border-blue-200 text-blue-700",
  Old: "bg-slate-50 border-slate-200 text-slate-500",
  "Updated/Extended": "bg-amber-50 border-amber-200 text-amber-700",
};

const LINK_COLUMNS = new Set(["bidLink", "buyerAddedBidSpecificAtcUrl"]);

export default function GemBidTable({ bids, currentUsername, onMoved, onViewHistory }: Props) {
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [displayLimit, setDisplayLimit] = useState(50);
  const [busy, setBusy] = useState(false);

  const currentSectionKey = bids[0]?.currentSection;
  const otherSections = SECTIONS.filter((s) => s.key !== currentSectionKey);
  const otherColumns = useMemo(() => BID_COLUMNS.filter((c) => c.key !== "bidNo"), []);

  const dropdownOptions = useMemo(() => {
    const map: Record<string, string[]> = {};
    BID_COLUMNS.filter((c) => c.filterType === "dropdown").forEach((c) => {
      const vals = new Set<string>();
      bids.forEach((b) => {
        if (b[c.key]) vals.add(String(b[c.key]));
      });
      map[c.key] = [...vals].sort();
    });
    return map;
  }, [bids]);

  const filtered = useMemo(() => {
    let list = bids.filter((b) => {
      for (const col of BID_COLUMNS) {
        const f = filters[col.key];
        if (!f) continue;
        if (col.filterType === "text") {
          if (!String(b[col.key] || "").toLowerCase().includes(String(f).toLowerCase())) return false;
        } else if (col.filterType === "dropdown") {
          if (String(b[col.key] || "") !== f) return false;
        } else if (col.filterType === "dateRange") {
          const val = String(b[col.key] || "");
          if (f.from && val < f.from) return false;
          if (f.to && val > f.to) return false;
        }
      }
      return true;
    });
    if (sort) {
      list = [...list].sort((a, b) => {
        const cmp = String(a[sort.key] || "").localeCompare(String(b[sort.key] || ""));
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return list;
  }, [bids, filters, sort]);

  const visible = filtered.slice(0, displayLimit);

  const toggleSort = (key: string) => {
    setSort((prev) => (prev?.key === key ? (prev.dir === "asc" ? { key, dir: "desc" } : null) : { key, dir: "asc" }));
  };

  const toggleSelectAll = () => {
    setSelected((prev) => {
      const allSelected = visible.length > 0 && visible.every((b) => prev.has(b.bidNo));
      const next = new Set(prev);
      visible.forEach((b) => (allSelected ? next.delete(b.bidNo) : next.add(b.bidNo)));
      return next;
    });
  };

  const toggleSelectOne = (bidNo: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(bidNo)) next.delete(bidNo);
      else next.add(bidNo);
      return next;
    });
  };

  const sendTo = async (toSection: SectionKey, bidNos: string[]) => {
    if (bidNos.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/gem-bids/move", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidNos, toSection, movedBy: currentUsername }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Move failed");
      setSelected(new Set());
      onMoved();
    } catch (err: any) {
      alert(err.message || "Move failed");
    } finally {
      setBusy(false);
    }
  };

  const sendBack = async (bidNos: string[]) => {
    if (bidNos.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/gem-bids/send-back", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidNos, movedBy: currentUsername }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send back failed");
      setSelected((prev) => {
        const next = new Set(prev);
        bidNos.forEach((b) => next.delete(b));
        return next;
      });
      onMoved();
    } catch (err: any) {
      alert(err.message || "Send back failed");
    } finally {
      setBusy(false);
    }
  };

  const selectedList = [...selected];

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      {selectedList.length > 0 && (
        <div className="p-3 bg-blue-50 border-b border-blue-100 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-black text-blue-700 uppercase">{selectedList.length} selected</span>
          <span className="text-[10px] text-blue-400 font-bold uppercase">Send to:</span>
          {otherSections.map((s) => (
            <button
              key={s.key}
              disabled={busy}
              onClick={() => sendTo(s.key, selectedList)}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-[10px] font-black uppercase px-3 py-1.5 rounded-lg transition-colors"
            >
              {s.label}
            </button>
          ))}
          {currentSectionKey !== "fetched_bid_data" && (
            <button
              disabled={busy}
              onClick={() => sendBack(selectedList)}
              className="bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-[10px] font-black uppercase px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
            >
              <FiCornerUpLeft size={11} /> Send Back
            </button>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-[11px] border-collapse">
          <thead>
            <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
              <th className="py-2 px-2">
                <input
                  type="checkbox"
                  checked={visible.length > 0 && visible.every((b) => selected.has(b.bidNo))}
                  onChange={toggleSelectAll}
                />
              </th>
              <th className="py-2 px-2 cursor-pointer whitespace-nowrap" onClick={() => toggleSort("bidNo")}>
                Bid No {sort?.key === "bidNo" && (sort.dir === "asc" ? <FiChevronUp className="inline" size={10} /> : <FiChevronDown className="inline" size={10} />)}
              </th>
              <th className="py-2 px-2 whitespace-nowrap">Tag</th>
              {otherColumns.map((col) => (
                <th key={col.key} className="py-2 px-2 cursor-pointer whitespace-nowrap" onClick={() => toggleSort(col.key)}>
                  {col.header} {sort?.key === col.key && (sort.dir === "asc" ? <FiChevronUp className="inline" size={10} /> : <FiChevronDown className="inline" size={10} />)}
                </th>
              ))}
              <th className="py-2 px-2">Actions</th>
            </tr>
            <tr className="bg-white border-b border-slate-200">
              <th className="py-1.5 px-2"></th>
              <th className="py-1.5 px-2">
                <input
                  value={filters.bidNo || ""}
                  onChange={(e) => setFilters((f) => ({ ...f, bidNo: e.target.value }))}
                  placeholder="Search..."
                  className="w-full min-w-[110px] bg-slate-50 border border-slate-200 rounded px-1.5 py-1 text-[10px]"
                />
              </th>
              <th className="py-1.5 px-2"></th>
              {otherColumns.map((col) => (
                <th key={col.key} className="py-1.5 px-2">
                  {col.filterType === "text" && (
                    <input
                      value={filters[col.key] || ""}
                      onChange={(e) => setFilters((f) => ({ ...f, [col.key]: e.target.value }))}
                      placeholder="Search..."
                      className="w-full min-w-[100px] bg-slate-50 border border-slate-200 rounded px-1.5 py-1 text-[10px]"
                    />
                  )}
                  {col.filterType === "dropdown" && (
                    <select
                      value={filters[col.key] || ""}
                      onChange={(e) => setFilters((f) => ({ ...f, [col.key]: e.target.value }))}
                      className="w-full min-w-[100px] bg-slate-50 border border-slate-200 rounded px-1.5 py-1 text-[10px]"
                    >
                      <option value="">All</option>
                      {(dropdownOptions[col.key] || []).map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  )}
                  {col.filterType === "dateRange" && (
                    <div className="flex gap-1">
                      <input
                        type="date"
                        value={filters[col.key]?.from || ""}
                        onChange={(e) => setFilters((f) => ({ ...f, [col.key]: { ...(f[col.key] || {}), from: e.target.value } }))}
                        className="w-full bg-slate-50 border border-slate-200 rounded px-1 py-1 text-[9px]"
                      />
                      <input
                        type="date"
                        value={filters[col.key]?.to || ""}
                        onChange={(e) => setFilters((f) => ({ ...f, [col.key]: { ...(f[col.key] || {}), to: e.target.value } }))}
                        className="w-full bg-slate-50 border border-slate-200 rounded px-1 py-1 text-[9px]"
                      />
                    </div>
                  )}
                </th>
              ))}
              <th className="py-1.5 px-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={otherColumns.length + 4} className="text-center py-10 text-slate-400 text-xs font-bold uppercase tracking-widest">
                  No bids here
                </td>
              </tr>
            ) : (
              visible.map((b) => (
                <tr key={b.bidNo} className={`hover:bg-blue-50/40 transition-colors ${b.isHighlighted ? "bg-yellow-50" : ""}`}>
                  <td className="py-2 px-2">
                    <input type="checkbox" checked={selected.has(b.bidNo)} onChange={() => toggleSelectOne(b.bidNo)} />
                  </td>
                  <td className="py-2 px-2 font-mono font-bold text-slate-700 whitespace-nowrap">
                    {b.bidNo}
                    {b.hasPendingUpdate && (
                      <span className="ml-1.5 bg-purple-50 border border-purple-200 text-purple-700 text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full">
                        Updated
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-2">
                    <button
                      onClick={() => onViewHistory(b.bidNo)}
                      className={`border text-[9px] font-black uppercase px-2 py-0.5 rounded-full whitespace-nowrap ${TAG_STYLES[b.tag]}`}
                    >
                      {b.tag}
                    </button>
                  </td>
                  {otherColumns.map((col) => (
                    <td key={col.key} className="py-2 px-2 max-w-[200px] truncate text-slate-600" title={String(b[col.key] || "")}>
                      {LINK_COLUMNS.has(col.key) ? (
                        b[col.key] ? (
                          <a href={b[col.key]} target="_blank" rel="noreferrer" className="text-blue-600 underline">
                            Link
                          </a>
                        ) : (
                          "—"
                        )
                      ) : (
                        b[col.key] || "—"
                      )}
                    </td>
                  ))}
                  <td className="py-2 px-2">
                    {currentSectionKey !== "fetched_bid_data" && (
                      <button
                        disabled={busy}
                        onClick={() => sendBack([b.bidNo])}
                        title="Send Back"
                        className="p-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 transition-colors disabled:opacity-40"
                      >
                        <FiCornerUpLeft size={12} />
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > displayLimit && (
        <div className="p-3 text-center border-t border-slate-100">
          <button onClick={() => setDisplayLimit((l) => l + 50)} className="text-[11px] font-black uppercase text-blue-600 hover:text-blue-800">
            Load More ({filtered.length - displayLimit} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
