"use client";
import { useState, useMemo, useRef } from "react";
import { FiChevronUp, FiChevronDown, FiChevronLeft, FiChevronRight, FiCornerUpLeft, FiTrash2, FiEdit2, FiX } from "react-icons/fi";
import { BID_COLUMNS, EDITABLE_FIELD_KEYS, CELL_DISPLAY_FORMATTERS, SECTIONS, SectionKey, AUTO_ONLY_SECTIONS, SUBMITTED_STATUSES } from "@/lib/gemBids/columns";

export interface GemBid {
  _id: string;
  bidNo: string;
  tag: "Old" | "New Published" | "Updated/Extended";
  isHighlighted: boolean;
  currentSection: SectionKey;
  hasPendingUpdate: boolean;
  changedFields?: string[];
  justPromoted?: boolean;
  submittedStatus?: string | null;
  manuallyEdited?: boolean;
  [key: string]: any;
}

// Sections where a bid has moved past the raw scrape and is now being
// worked on by hand - Edit Bid only makes sense once it's here (per spec:
// editing is offered starting at Bids Can Be Filled onward, not while a bid
// is still New/Fetched raw data).
const EDITABLE_SECTIONS = new Set<SectionKey>(["bids_can_be_filled", "bids_to_fill", "bid_document_maker", "submitted_bids"]);

interface Props {
  bids: GemBid[];
  currentUsername: string;
  // Patches the parent's full bids array directly (functional update) so a
  // move/delete/status-change reflects instantly - no full refetch, which
  // used to flip the parent's `loading` flag and replace this whole table
  // with a full-page spinner on every single action.
  onBidsUpdated: (updater: (prev: GemBid[]) => GemBid[]) => void;
  onViewHistory: (bidNo: string) => void;
}

const TAG_STYLES: Record<string, string> = {
  "New Published": "bg-blue-50 border-blue-200 text-blue-700",
  Old: "bg-slate-50 border-slate-200 text-slate-500",
  "Updated/Extended": "bg-amber-50 border-amber-200 text-amber-700",
};

const LINK_COLUMNS = new Set(["bidLink", "buyerAddedBidSpecificAtcUrl"]);

// Three columns render a second field stacked underneath the first (folded
// in via BID_COLUMNS' hiddenInTable so that second field still gets its own
// filter row cell and cell rendering here instead of a plain column):
// Address (+ Department), Bid To RA (+ RA), Evaluation (+ EMD Amount).
const MERGED_COLUMN_LABELS: Record<string, string> = {
  address: "Address / Dept / City",
  bidToRaEnabled: "Bid To RA / RA",
  evaluationMethod: "Evaluation / EMD",
  documentRequiredFromSeller: "Doc Required / ATC",
};

// Body-row rendering for the merged (stacked) columns - each maps its
// header key to every field key stacked inside that one cell, first on top.
const STACKED_GROUPS: Record<string, string[]> = {
  address: ["address", "departmentNameAndAddress", "consigneeCity"],
  bidToRaEnabled: ["bidToRaEnabled", "raQualificationRule"],
  evaluationMethod: ["evaluationMethod", "emdAmount"],
  documentRequiredFromSeller: ["documentRequiredFromSeller", "buyerAddedBidSpecificAtcUrl"],
};

// Columns whose filter-row cell is either handled by one of the merged
// blocks above (so the generic text/dropdown renderer below must skip it,
// or it'd duplicate the control) or has no search box at all by request
// (Bid Link is just a "Link" hyperlink - nothing to text-search; QTY is
// short numbers).
const MERGED_OR_UNSEARCHABLE_COLUMNS = new Set([
  "address",
  "bidToRaEnabled",
  "evaluationMethod",
  "documentRequiredFromSeller",
  "bidLink",
  "quantityListing",
]);

export default function GemBidTable({ bids, currentUsername, onBidsUpdated, onViewHistory }: Props) {
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [displayLimit, setDisplayLimit] = useState(50);
  const [busy, setBusy] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollByPage = (dir: 1 | -1) => {
    scrollRef.current?.scrollBy({ left: dir * 400, behavior: "smooth" });
  };

  const [editingBid, setEditingBid] = useState<GemBid | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [editSaving, setEditSaving] = useState(false);

  const openEdit = (bid: GemBid) => {
    const values: Record<string, string> = {};
    EDITABLE_FIELD_KEYS.forEach((key) => (values[key] = String(bid[key] ?? "")));
    setEditValues(values);
    setEditingBid(bid);
  };

  const saveEdit = async () => {
    if (!editingBid) return;
    setEditSaving(true);
    try {
      const res = await fetch("/api/gem-bids", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidNo: editingBid.bidNo, fields: editValues, editedBy: currentUsername }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Edit failed");
      onBidsUpdated((prev) => prev.map((b) => (b.bidNo === editingBid.bidNo ? { ...b, ...data.bid } : b)));
      setEditingBid(null);
    } catch (err: any) {
      alert(err.message || "Edit failed");
    } finally {
      setEditSaving(false);
    }
  };

  const currentSectionKey = bids[0]?.currentSection;
  // New Bids is system-populated only (a bid lands there on first sight, never
  // via a manual "Send to") - never offered as a manual move target.
  const otherSections = SECTIONS.filter((s) => s.key !== currentSectionKey && !AUTO_ONLY_SECTIONS.includes(s.key));
  const otherColumns = useMemo(() => BID_COLUMNS.filter((c) => c.key !== "bidNo" && !c.hiddenInTable), []);

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
      const bidNoSet = new Set(bidNos);
      onBidsUpdated((prev) => prev.map((b) => (bidNoSet.has(b.bidNo) ? { ...b, currentSection: toSection } : b)));
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
      // Each bid pops back to whatever its own sectionStack had (not
      // necessarily the same section for every bid in a bulk send-back), so
      // apply the server's per-bid movedTo rather than a single toSection.
      const movedToByBidNo = new Map<string, SectionKey>();
      (data.results || []).forEach((r: any) => {
        if (r.movedTo) movedToByBidNo.set(r.bidNo, r.movedTo);
      });
      onBidsUpdated((prev) =>
        prev.map((b) => (movedToByBidNo.has(b.bidNo) ? { ...b, currentSection: movedToByBidNo.get(b.bidNo)! } : b))
      );
    } catch (err: any) {
      alert(err.message || "Send back failed");
    } finally {
      setBusy(false);
    }
  };

  const deleteBids = async (bidNos: string[]) => {
    if (bidNos.length === 0) return;
    const label = bidNos.length === 1 ? `bid ${bidNos[0]}` : `${bidNos.length} bids`;
    if (!confirm(`Delete ${label}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/gem-bids", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidNos }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      setSelected((prev) => {
        const next = new Set(prev);
        bidNos.forEach((b) => next.delete(b));
        return next;
      });
      const bidNoSet = new Set(bidNos);
      onBidsUpdated((prev) => prev.filter((b) => !bidNoSet.has(b.bidNo)));
    } catch (err: any) {
      alert(err.message || "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const updateSubmittedStatus = async (bidNo: string, status: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/gem-bids/submitted-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: [{ bidNo, status }] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Status update failed");
      onBidsUpdated((prev) => prev.map((b) => (b.bidNo === bidNo ? { ...b, submittedStatus: status } : b)));
    } catch (err: any) {
      alert(err.message || "Status update failed");
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
          <button
            disabled={busy}
            onClick={() => deleteBids(selectedList)}
            className="bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white text-[10px] font-black uppercase px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 ml-auto"
          >
            <FiTrash2 size={11} /> Delete
          </button>
        </div>
      )}

      <div className="relative">
        <button
          type="button"
          onClick={() => scrollByPage(-1)}
          aria-label="Scroll table left"
          className="absolute left-1 top-1/2 -translate-y-1/2 z-10 bg-white/95 hover:bg-white border border-slate-200 shadow-md rounded-full p-1.5 text-slate-600 hover:text-blue-600 transition-colors"
        >
          <FiChevronLeft size={16} />
        </button>
        <button
          type="button"
          onClick={() => scrollByPage(1)}
          aria-label="Scroll table right"
          className="absolute right-1 top-1/2 -translate-y-1/2 z-10 bg-white/95 hover:bg-white border border-slate-200 shadow-md rounded-full p-1.5 text-slate-600 hover:text-blue-600 transition-colors"
        >
          <FiChevronRight size={16} />
        </button>
        <div ref={scrollRef} className="overflow-x-auto no-scrollbar">
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
              <th className="py-2 px-2 whitespace-nowrap">Tag</th>
              <th className="py-2 px-2 cursor-pointer whitespace-nowrap" onClick={() => toggleSort("bidNo")}>
                Bid No {sort?.key === "bidNo" && (sort.dir === "asc" ? <FiChevronUp className="inline" size={10} /> : <FiChevronDown className="inline" size={10} />)}
              </th>
              {currentSectionKey === "submitted_bids" && <th className="py-2 px-2 whitespace-nowrap">Status</th>}
              {otherColumns.map((col) => (
                <th key={col.key} className="py-2 px-2 cursor-pointer whitespace-nowrap" onClick={() => toggleSort(col.key)}>
                  {MERGED_COLUMN_LABELS[col.key] || col.header}{" "}
                  {sort?.key === col.key && (sort.dir === "asc" ? <FiChevronUp className="inline" size={10} /> : <FiChevronDown className="inline" size={10} />)}
                </th>
              ))}
              <th className="py-2 px-2">Actions</th>
            </tr>
            <tr className="bg-white border-b border-slate-200">
              <th className="py-1.5 px-2"></th>
              <th className="py-1.5 px-2"></th>
              <th className="py-1.5 px-2">
                <input
                  value={filters.bidNo || ""}
                  onChange={(e) => setFilters((f) => ({ ...f, bidNo: e.target.value }))}
                  placeholder="Search..."
                  className="w-full min-w-[110px] bg-slate-50 border border-slate-200 rounded px-1.5 py-1 text-[10px]"
                />
              </th>
              {currentSectionKey === "submitted_bids" && <th className="py-1.5 px-2"></th>}
              {otherColumns.map((col) => (
                <th key={col.key} className="py-1.5 px-2">
                  {col.key === "address" && (
                    <div className="flex flex-col gap-1">
                      <input
                        value={filters.address || ""}
                        onChange={(e) => setFilters((f) => ({ ...f, address: e.target.value }))}
                        placeholder="Search address..."
                        className="w-full min-w-[140px] bg-slate-50 border border-slate-200 rounded px-1.5 py-1 text-[10px]"
                      />
                      <input
                        value={filters.departmentNameAndAddress || ""}
                        onChange={(e) => setFilters((f) => ({ ...f, departmentNameAndAddress: e.target.value }))}
                        placeholder="Search department..."
                        className="w-full min-w-[140px] bg-slate-50 border border-slate-200 rounded px-1.5 py-1 text-[10px]"
                      />
                      <select
                        value={filters.consigneeCity || ""}
                        onChange={(e) => setFilters((f) => ({ ...f, consigneeCity: e.target.value }))}
                        className="w-full min-w-[140px] bg-slate-50 border border-slate-200 rounded px-1.5 py-1 text-[10px]"
                      >
                        <option value="">City: All</option>
                        {(dropdownOptions.consigneeCity || []).map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {/* Bid To RA's own Yes/No/All dropdown, with RA's dropdown (was a
                      text box - now a scrollable pick-list per request) stacked below it. */}
                  {col.key === "bidToRaEnabled" && (
                    <div className="flex flex-col gap-1">
                      <select
                        value={filters.bidToRaEnabled || ""}
                        onChange={(e) => setFilters((f) => ({ ...f, bidToRaEnabled: e.target.value }))}
                        className="w-full min-w-[80px] bg-slate-50 border border-slate-200 rounded px-1.5 py-1 text-[10px]"
                      >
                        <option value="">All</option>
                        {(dropdownOptions.bidToRaEnabled || []).map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                      <select
                        value={filters.raQualificationRule || ""}
                        onChange={(e) => setFilters((f) => ({ ...f, raQualificationRule: e.target.value }))}
                        className="w-full min-w-[80px] bg-slate-50 border border-slate-200 rounded px-1.5 py-1 text-[10px]"
                      >
                        <option value="">RA: All</option>
                        {(dropdownOptions.raQualificationRule || []).map((v) => (
                          <option key={v} value={v}>
                            {CELL_DISPLAY_FORMATTERS.raQualificationRule ? CELL_DISPLAY_FORMATTERS.raQualificationRule(v) : v}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {/* Evaluation's own dropdown, with EMD Amount's text search stacked below it. */}
                  {col.key === "evaluationMethod" && (
                    <div className="flex flex-col gap-1">
                      <select
                        value={filters.evaluationMethod || ""}
                        onChange={(e) => setFilters((f) => ({ ...f, evaluationMethod: e.target.value }))}
                        className="w-full min-w-[80px] bg-slate-50 border border-slate-200 rounded px-1.5 py-1 text-[10px]"
                      >
                        <option value="">All</option>
                        {(dropdownOptions.evaluationMethod || []).map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                      <input
                        value={filters.emdAmount || ""}
                        onChange={(e) => setFilters((f) => ({ ...f, emdAmount: e.target.value }))}
                        placeholder="Search EMD..."
                        className="w-full min-w-[80px] bg-slate-50 border border-slate-200 rounded px-1.5 py-1 text-[10px]"
                      />
                    </div>
                  )}
                  {/* Document required from seller's own text search, with ATC's
                      (also just text-search on its URL) stacked below it. */}
                  {col.key === "documentRequiredFromSeller" && (
                    <div className="flex flex-col gap-1">
                      <input
                        value={filters.documentRequiredFromSeller || ""}
                        onChange={(e) => setFilters((f) => ({ ...f, documentRequiredFromSeller: e.target.value }))}
                        placeholder="Search..."
                        className="w-full min-w-[100px] bg-slate-50 border border-slate-200 rounded px-1.5 py-1 text-[10px]"
                      />
                      <input
                        value={filters.buyerAddedBidSpecificAtcUrl || ""}
                        onChange={(e) => setFilters((f) => ({ ...f, buyerAddedBidSpecificAtcUrl: e.target.value }))}
                        placeholder="Search ATC..."
                        className="w-full min-w-[100px] bg-slate-50 border border-slate-200 rounded px-1.5 py-1 text-[10px]"
                      />
                    </div>
                  )}
                  {/* Bid Link and QTY have no search box by request - Bid Link is just a
                      "Link" hyperlink (nothing to text-search), QTY is short numbers. */}
                  {col.filterType === "text" &&
                    !MERGED_OR_UNSEARCHABLE_COLUMNS.has(col.key) && (
                      <input
                        value={filters[col.key] || ""}
                        onChange={(e) => setFilters((f) => ({ ...f, [col.key]: e.target.value }))}
                        placeholder="Search..."
                        className="w-full min-w-[100px] bg-slate-50 border border-slate-200 rounded px-1.5 py-1 text-[10px]"
                      />
                    )}
                  {col.filterType === "dropdown" && !MERGED_OR_UNSEARCHABLE_COLUMNS.has(col.key) && (
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
                    <div className="flex flex-col gap-1">
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
                <td colSpan={otherColumns.length + (currentSectionKey === "submitted_bids" ? 5 : 4)} className="text-center py-10 text-slate-400 text-xs font-bold uppercase tracking-widest">
                  No bids here
                </td>
              </tr>
            ) : (
              visible.map((b) => {
                const changedSet = new Set(b.changedFields || []);
                return (
                <tr
                  key={b.bidNo}
                  // justPromoted (blue background, New Bids -> Fetched Bid Data arrival) and
                  // isHighlighted (yellow, the extension's own "paper-based printing" rule) are
                  // deliberately different colors so the two never look the same.
                  className={`hover:bg-blue-50/40 transition-colors ${b.justPromoted ? "bg-blue-50" : b.isHighlighted ? "bg-yellow-50" : ""}`}
                >
                  <td className="py-2 px-2">
                    <input type="checkbox" checked={selected.has(b.bidNo)} onChange={() => toggleSelectOne(b.bidNo)} />
                  </td>
                  <td className="py-2 px-2">
                    <button
                      onClick={() => onViewHistory(b.bidNo)}
                      title={b.tag}
                      className={`border text-[9px] font-black uppercase px-2 py-0.5 rounded-full whitespace-nowrap ${TAG_STYLES[b.tag]}`}
                    >
                      {b.tag === "New Published" ? "N" : b.tag}
                    </button>
                  </td>
                  <td className="py-2 px-2 font-mono font-bold text-slate-700 whitespace-nowrap">
                    {b.bidNo}
                    {b.hasPendingUpdate && (
                      <span className="ml-1.5 bg-purple-50 border border-purple-200 text-purple-700 text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full">
                        Updated
                      </span>
                    )}
                  </td>
                  {currentSectionKey === "submitted_bids" && (
                    <td className="py-2 px-2">
                      <select
                        value={b.submittedStatus || "Active"}
                        disabled={busy}
                        onChange={(e) => updateSubmittedStatus(b.bidNo, e.target.value)}
                        className="bg-slate-50 border border-slate-200 rounded px-1.5 py-1 text-[10px] font-bold"
                      >
                        {SUBMITTED_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  {otherColumns.map((col) => {
                    // Renders one of the three merged (stacked) cells - see
                    // STACKED_GROUPS/MERGED_COLUMN_LABELS above for why these keys.
                    const group = STACKED_GROUPS[col.key];
                    if (group) {
                      // Address gets more room than the others (per request) - it's
                      // also the only 3-line group, so it needs it more.
                      const wide = col.key === "address";
                      return (
                        <td key={col.key} className={`py-2 px-2 ${wide ? "max-w-[300px]" : "max-w-[220px]"}`}>
                          {group.map((fieldKey, i) => {
                            if (LINK_COLUMNS.has(fieldKey)) {
                              return (
                                <div key={fieldKey} className={i === 0 ? "" : "text-[10px]"}>
                                  {b[fieldKey] ? (
                                    <a href={b[fieldKey]} target="_blank" rel="noreferrer" className="text-blue-600 underline">
                                      Link
                                    </a>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </div>
                              );
                            }
                            const fmt = CELL_DISPLAY_FORMATTERS[fieldKey];
                            const val = (fmt ? fmt(b[fieldKey]) : b[fieldKey]) || "—";
                            return (
                              <div
                                key={fieldKey}
                                className={`truncate ${i === 0 ? "" : "text-[10px]"} ${
                                  changedSet.has(fieldKey) ? "text-blue-700 font-bold" : i === 0 ? "text-slate-600" : "text-slate-400"
                                }`}
                                title={String(b[fieldKey] || "")}
                              >
                                {val}
                              </div>
                            );
                          })}
                        </td>
                      );
                    }
                    return (
                      <td
                        key={col.key}
                        // Blue text = this specific field changed on the most recent sync
                        // (existing bid, stayed in place) - visually distinct from the blue
                        // row background above, which only ever means "just promoted".
                        className={`py-2 px-2 max-w-[200px] truncate ${changedSet.has(col.key) ? "text-blue-700 font-bold" : "text-slate-600"}`}
                        title={String(b[col.key] || "")}
                      >
                        {LINK_COLUMNS.has(col.key) ? (
                          b[col.key] ? (
                            <a href={b[col.key]} target="_blank" rel="noreferrer" className="text-blue-600 underline">
                              Link
                            </a>
                          ) : (
                            "—"
                          )
                        ) : (
                          (CELL_DISPLAY_FORMATTERS[col.key] ? CELL_DISPLAY_FORMATTERS[col.key](b[col.key]) : b[col.key]) || "—"
                        )}
                      </td>
                    );
                  })}
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-1">
                      {EDITABLE_SECTIONS.has(currentSectionKey) && (
                        <button
                          disabled={busy || b.manuallyEdited}
                          onClick={() => openEdit(b)}
                          title={b.manuallyEdited ? "Already edited once — locked" : "Edit Bid"}
                          className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition-colors disabled:opacity-40"
                        >
                          <FiEdit2 size={12} />
                        </button>
                      )}
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
                      <button
                        disabled={busy}
                        onClick={() => deleteBids([b.bidNo])}
                        title="Delete"
                        className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition-colors disabled:opacity-40"
                      >
                        <FiTrash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>
      </div>

      {filtered.length > displayLimit && (
        <div className="p-3 text-center border-t border-slate-100 flex items-center justify-center gap-4">
          <button onClick={() => setDisplayLimit((l) => l + 50)} className="text-[11px] font-black uppercase text-blue-600 hover:text-blue-800">
            Load More ({filtered.length - displayLimit} remaining)
          </button>
          <button onClick={() => setDisplayLimit(filtered.length)} className="text-[11px] font-black uppercase text-slate-500 hover:text-slate-800">
            Load All Bids
          </button>
        </div>
      )}

      {editingBid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden shadow-2xl flex flex-col">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">Edit Bid — {editingBid.bidNo}</h3>
                <p className="text-[10px] text-slate-400 mt-0.5">This bid can only be edited once — check everything before saving.</p>
              </div>
              <button onClick={() => setEditingBid(null)} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                <FiX size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {BID_COLUMNS.filter((c) => c.key !== "bidNo").map((col) => (
                <div key={col.key}>
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider block mb-1">{col.header}</label>
                  <input
                    value={editValues[col.key] ?? ""}
                    onChange={(e) => setEditValues((v) => ({ ...v, [col.key]: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
            </div>
            <div className="p-5 border-t border-slate-100 flex justify-end gap-2">
              <button
                onClick={() => setEditingBid(null)}
                className="px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wide bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={editSaving}
                className="px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wide bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white transition-colors"
              >
                Save (one-time)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
