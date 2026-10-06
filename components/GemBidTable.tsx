"use client";
import { useState, useMemo, useRef, useEffect, type ReactNode } from "react";
import { FiChevronUp, FiChevronDown, FiChevronLeft, FiChevronRight, FiCornerUpLeft, FiTrash2, FiEdit2, FiX, FiRefreshCw } from "react-icons/fi";
import { BID_COLUMNS, EDITABLE_FIELD_KEYS, CELL_DISPLAY_FORMATTERS, SECTIONS, SectionKey, AUTO_ONLY_SECTIONS } from "@/lib/gemBids/columns";

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
// editing is offered starting at Bids to Fill onward, not while a bid is
// still New/Fetched raw data).
const EDITABLE_SECTIONS = new Set<SectionKey>(["bids_to_fill", "submitted_bids"]);

interface Company {
  _id: string;
  firmName: string;
  firmCode?: string;
}

interface Seller {
  _id: string;
  instituteName?: string;
  buyerName?: string;
  gemLocationText?: string;
}

// Mirrors guessBuyerForOrder in app/dashboard/orders/fetch-gem-orders/page.tsx
// exactly (substring-containment either direction, same minimum-length
// guard against a short/generic string hijacking every bid's guess) - a
// Seller's gemLocationText can hold more than one GeM-shown location
// variant for the same institute, comma-separated (GeM doesn't always word
// it identically across bids), each checked in turn.
const MIN_INSTITUTE_MATCH_LEN = 8;
function guessInstituteForAddress(rawAddress: string, sellers: Seller[]): string | null {
  const rawLoc = (rawAddress || "").toLowerCase();
  if (!rawLoc) return null;

  for (const s of sellers) {
    const name = s.instituteName || s.buyerName || "";
    if (!name) continue;
    const variants = (s.gemLocationText || "")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
    for (const gemLoc of variants) {
      if (gemLoc.length >= MIN_INSTITUTE_MATCH_LEN && (rawLoc.includes(gemLoc) || gemLoc.includes(rawLoc))) {
        return name;
      }
    }
  }
  for (const s of sellers) {
    const name = (s.instituteName || s.buyerName || "").trim();
    if (name.length >= MIN_INSTITUTE_MATCH_LEN && (rawLoc.includes(name.toLowerCase()) || name.toLowerCase().includes(rawLoc))) {
      return name;
    }
  }
  return null;
}

interface Props {
  bids: GemBid[];
  currentUsername: string;
  // Patches the parent's full bids array directly (functional update) so a
  // move/delete/status-change reflects instantly - no full refetch, which
  // used to flip the parent's `loading` flag and replace this whole table
  // with a full-page spinner on every single action.
  onBidsUpdated: (updater: (prev: GemBid[]) => GemBid[]) => void;
  onViewHistory: (bidNo: string) => void;
  // Pixel offset (global header + page's own sticky title/tabs row) that the
  // filter panel below should stick under - passed down from GemBidsPage,
  // which measures it live via ResizeObserver. Defaults to 0 (sticks to the
  // very top) if not given.
  stickyTop?: number;
  // True for the "All Bids" tab - bids here come from every section mixed
  // together, so per-row actions read each row's own currentSection instead
  // of assuming one shared section, a "Section" column replaces the
  // section-specific ones (Status/Bid Status/Party), and the bulk "Send to"
  // bar is hidden (moving a mixed selection to one target section isn't a
  // sensible single action).
  allSectionsMode?: boolean;
}

const TAG_STYLES: Record<string, string> = {
  "New Published": "bg-blue-50 border-blue-200 text-blue-700",
  Old: "bg-slate-50 border-slate-200 text-slate-500",
  "Updated/Extended": "bg-amber-50 border-amber-200 text-amber-700",
};

// Short badge text by request - hover (the button's title attribute) still
// shows the full tag name. "Old" is already short, left as-is.
const TAG_SHORT_LABELS: Record<string, string> = {
  "New Published": "N",
  "Updated/Extended": "U/E",
};

const LINK_COLUMNS = new Set(["bidLink", "buyerAddedBidSpecificAtcUrl", "specificationDocumentUrl", "boqDetailDocumentUrl"]);
// Short prefix for a stacked link line, so three link lines in the same
// cell (ATC/Spec/BOQ, all under Document required from seller) read as
// which-is-which instead of three identical bare "Link"s. Unset (plain
// "Link") for a link column that's never stacked with another one.
const STACKED_LINK_PREFIX: Record<string, string> = {
  buyerAddedBidSpecificAtcUrl: "ATC",
  specificationDocumentUrl: "Spec",
  boqDetailDocumentUrl: "BOQ",
};

// Three columns render a second field stacked underneath the first (folded
// in via BID_COLUMNS' hiddenInTable so that second field still gets its own
// filter row cell and cell rendering here instead of a plain column):
// Address (+ Department), Bid To RA (+ RA), Evaluation (+ EMD Amount).
const MERGED_COLUMN_LABELS: Record<string, string> = {
  address: "Address / Dept / City",
  bidToRaEnabled: "Bid To RA / RA",
  evaluationMethod: "Evaluation / EMD",
  documentRequiredFromSeller: "Doc Required / ATC / Spec / BOQ",
};

// Body-row rendering for the merged (stacked) columns - each maps its
// header key to every field key stacked inside that one cell, first on top.
const STACKED_GROUPS: Record<string, string[]> = {
  address: ["address", "departmentNameAndAddress", "consigneeCity"],
  bidToRaEnabled: ["bidToRaEnabled", "raQualificationRule"],
  evaluationMethod: ["evaluationMethod", "emdAmount"],
  documentRequiredFromSeller: [
    "documentRequiredFromSeller",
    "buyerAddedBidSpecificAtcUrl",
    "specificationDocumentUrl",
    "boqDetailDocumentUrl",
  ],
};

// A per-column max-width, sized to what each stacked cell actually tends to
// hold - a single "max-w-[220px] for everything but address" used to leave
// Evaluation/EMD and Bid To RA/RA (both short: a word or two, a percentage/
// grade) with a wide gap of empty space before the next column, since
// table-layout:auto hands a column however much room its max-w allows
// regardless of whether the content fills it.
const STACKED_CELL_MAX_WIDTH: Record<string, string> = {
  address: "max-w-[300px]",
  bidToRaEnabled: "max-w-[110px]",
  evaluationMethod: "max-w-[110px]",
  documentRequiredFromSeller: "max-w-[260px]",
};

export default function GemBidTable({
  bids,
  currentUsername,
  onBidsUpdated,
  onViewHistory,
  stickyTop = 0,
  allSectionsMode = false,
}: Props) {
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [displayLimit, setDisplayLimit] = useState(50);
  const [busy, setBusy] = useState(false);
  // Bid To RA/RA/Type of Bid/Evaluation aren't searched often enough to earn
  // permanent space - collapsed by default, a button reveals them.
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  // Attached to every move-history row a "Send to" click creates.
  const [moveRemark, setMoveRemark] = useState("");

  // Companies list backs the Party dropdown in Bids to Fill.
  const [companies, setCompanies] = useState<Company[]>([]);
  useEffect(() => {
    fetch("/api/companies")
      .then((res) => res.json())
      .then((data) => setCompanies(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load companies", err));
  }, []);

  // Sellers list backs the Address column's institute auto-match (see
  // guessInstituteForAddress below) - same /api/sellers + gemLocationText
  // data the Fetch GeM Orders page already uses to turn a raw scraped
  // location into a clean Institute Name.
  const [sellers, setSellers] = useState<Seller[]>([]);
  useEffect(() => {
    fetch("/api/sellers")
      .then((res) => res.json())
      .then((data) => setSellers(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load sellers", err));
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollByPage = (dir: 1 | -1) => {
    scrollRef.current?.scrollBy({ left: dir * 400, behavior: "smooth" });
  };

  const [editingBid, setEditingBid] = useState<GemBid | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [editSaving, setEditSaving] = useState(false);

  // Shared master list of document-type names (also used by Document
  // Maker's per-firm vault, see /api/gem-bids/document-types) that backs
  // the "Document required from seller" multi-select below.
  const [documentTypes, setDocumentTypes] = useState<string[]>([]);
  const [newDocTypeInput, setNewDocTypeInput] = useState("");

  useEffect(() => {
    if (!editingBid) return;
    fetch("/api/gem-bids/document-types")
      .then((res) => res.json())
      .then((data) => setDocumentTypes(Array.isArray(data?.documentTypes) ? data.documentTypes : []))
      .catch((err) => console.error("Failed to load document types", err));
  }, [editingBid]);

  const openEdit = (bid: GemBid) => {
    const values: Record<string, string> = {};
    EDITABLE_FIELD_KEYS.forEach((key) => (values[key] = String(bid[key] ?? "")));
    setEditValues(values);
    setEditingBid(bid);
  };

  const selectedDocTypes = new Set(
    (editValues.documentRequiredFromSeller || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );

  const toggleDocType = (type: string) => {
    const next = new Set(selectedDocTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setEditValues((v) => ({ ...v, documentRequiredFromSeller: Array.from(next).join(", ") }));
  };

  const addDocType = async () => {
    const name = newDocTypeInput.trim();
    if (!name) return;
    setNewDocTypeInput("");
    // Select it on this bid right away rather than waiting on the network
    // round-trip - the persisted-list save below is best-effort for making
    // it available to future edits/Document Maker, not a prerequisite for
    // using it on this bid right now.
    const next = new Set(selectedDocTypes);
    next.add(name);
    setEditValues((v) => ({ ...v, documentRequiredFromSeller: Array.from(next).join(", ") }));
    if (!documentTypes.some((t) => t.toLowerCase() === name.toLowerCase())) {
      setDocumentTypes((prev) => [...prev, name]);
    }
    try {
      const res = await fetch("/api/gem-bids/document-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ add: name }),
      });
      const data = await res.json();
      if (Array.isArray(data?.documentTypes)) setDocumentTypes(data.documentTypes);
    } catch (err) {
      console.error("Failed to save new document type", err);
    }
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
  // In "All Bids" mode rows can each be in a different section, so anything
  // section-specific reads each row's own currentSection instead of this
  // shared value - see effectiveSectionFor() below.
  const RAW_DATA_SECTIONS = new Set<SectionKey>(["new_bids", "fetched_bid_data"]);
  const otherColumns = useMemo(() => BID_COLUMNS.filter((c) => c.key !== "bidNo" && !c.hiddenInTable), []);

  const effectiveSectionFor = (b: GemBid): SectionKey => (allSectionsMode ? b.currentSection : currentSectionKey);
  const showSectionCol = allSectionsMode;
  // Status/Bid Status/Party are each one specific section's own thing, not
  // shown in All Bids (or any other section) even for a row that happens to
  // be in that section - these used to also show in All Bids mode (matching
  // each row's own section), which turned out to be more confusing than
  // useful; reverted to simple single-section visibility by request.
  const showBidStatusCol = !allSectionsMode && currentSectionKey === "submitted_bids";
  const showPartyCol = !allSectionsMode && currentSectionKey === "bids_to_fill";
  const extraColCount = [showSectionCol, showBidStatusCol, showPartyCol].filter(Boolean).length;

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

  // One guessInstituteForAddress pass per bid up front (keyed by bidNo),
  // not re-run per render per row - sellers rarely changes and bids can run
  // into the thousands.
  const matchedInstituteByBidNo = useMemo(() => {
    const map = new Map<string, string>();
    if (sellers.length === 0) return map;
    for (const b of bids) {
      const guess = guessInstituteForAddress(b.address, sellers);
      if (guess) map.set(b.bidNo, guess);
    }
    return map;
  }, [bids, sellers]);

  const filtered = useMemo(() => {
    let list = bids.filter((b) => {
      // One combined search box covers both Address and Department (they
      // share one stacked cell/one filter box now) - matches if either
      // field contains the term, not both.
      const addressOrDeptTerm = String(filters.addressOrDept || "").toLowerCase();
      if (addressOrDeptTerm) {
        const addressHit = String(b.address || "").toLowerCase().includes(addressOrDeptTerm);
        const deptHit = String(b.departmentNameAndAddress || "").toLowerCase().includes(addressOrDeptTerm);
        if (!addressHit && !deptHit) return false;
      }
      // Tag isn't a BID_COLUMNS entry (it's a workflow field rendered
      // specially by this table, not scraped data), so it's filtered here
      // rather than in the generic loop below.
      if (filters.tag && b.tag !== filters.tag) return false;
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
        body: JSON.stringify({ bidNos, toSection, movedBy: currentUsername, remark: moveRemark.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Move failed");
      setSelected(new Set());
      setMoveRemark("");
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
    if (!confirm(`Delete ${label}? Kept in Deleted Bids for 7 days (restorable there) before it's gone for good.`)) return;
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

  const [refreshingStatuses, setRefreshingStatuses] = useState(false);

  // Queues every Submitted Bids bid for a GeM Bid Exporter re-check (same
  // background-worker-polls-the-OMS pattern as Start Sync and Fetch Bid
  // Documents) - the button just queues it, it doesn't wait for the
  // extension to actually finish (that can take a while across many bids).
  const refreshBidStatuses = async () => {
    setRefreshingStatuses(true);
    try {
      const res = await fetch("/api/gem-bids/refresh-status", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to queue status refresh");
      alert(`Queued ${data.queuedCount ?? 0} bid(s) for a status refresh. The extension checks about once a minute.`);
    } catch (err: any) {
      alert(err.message || "Failed to queue status refresh");
    } finally {
      setRefreshingStatuses(false);
    }
  };

  // Backs the Party multi-select (Bids to Fill and Submitted Bids) and the
  // Bid Status field (Submitted Bids) - a single small "set one field,
  // record who/when" endpoint rather than several near-identical ones.
  const quickUpdate = async (
    bidNo: string,
    field: "selectedPartyIds" | "bidStatus",
    value: string | string[]
  ) => {
    setBusy(true);
    try {
      const res = await fetch("/api/gem-bids/quick-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidNo, field, value, changedBy: currentUsername }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      onBidsUpdated((prev) =>
        prev.map((b) =>
          b.bidNo === bidNo
            ? { ...b, [field]: value, lastModifiedBy: currentUsername, lastModifiedAt: new Date().toISOString() }
            : b
        )
      );
    } catch (err: any) {
      alert(err.message || "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const selectedList = [...selected];

  // New Bids is system-populated only (a bid lands there on first sight,
  // never via a manual "Send to") - never offered as a manual move target.
  // In All Bids mode the valid move targets depend on which section the
  // selection is actually in - computed from the selected bids' own
  // sections, same list a normal single-section view would show, so moving
  // a bid found via All Bids works exactly like moving it from its own tab
  // would. A selection spanning more than one section has no single sensible
  // target list, so the bar is hidden rather than guessing.
  const selectedSections = allSectionsMode
    ? Array.from(
        new Set(selectedList.map((id) => bids.find((b) => b.bidNo === id)?.currentSection).filter(Boolean))
      )
    : [];
  const uniformSelectedSection: SectionKey | undefined =
    allSectionsMode && selectedSections.length === 1 ? (selectedSections[0] as SectionKey) : undefined;
  const sendToFromSection = allSectionsMode ? uniformSelectedSection : currentSectionKey;
  const otherSections = !sendToFromSection
    ? []
    : RAW_DATA_SECTIONS.has(sendToFromSection)
    ? SECTIONS.filter((s) => s.key === "bids_to_fill")
    : SECTIONS.filter((s) => s.key !== sendToFromSection && !AUTO_ONLY_SECTIONS.includes(s.key));

  const filterField = (label: string, node: ReactNode) => (
    <div key={label}>
      <label className="text-[8px] font-black uppercase text-slate-400 tracking-wider block mb-1">{label}</label>
      {node}
    </div>
  );

  return (
    // No overflow-hidden here (used to clip corners around the filter panel/
    // table below) - position: sticky further down only works relative to
    // the viewport if nothing between it and the page has overflow other
    // than visible, so the corner-rounding below is done per-block instead.
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
      {selectedList.length > 0 && (
        <div className="p-3 bg-blue-50 border-b border-blue-100 rounded-t-2xl flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-black text-blue-700 uppercase">{selectedList.length} selected</span>
          {otherSections.length > 0 && (
            <>
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
              <input
                value={moveRemark}
                onChange={(e) => setMoveRemark(e.target.value)}
                placeholder="Remark (optional)"
                className="border border-blue-200 rounded-lg px-2.5 py-1.5 text-[11px] w-40 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </>
          )}
          {(allSectionsMode || currentSectionKey !== "fetched_bid_data") && (
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

      {/* Filters live here, outside the table, so they stay put and legible
          regardless of how far the table itself is scrolled horizontally -
          they used to be a second header row inside the table and scrolled
          out of view/misaligned with their own column along with everything
          else. Also sticky (stacked right under the page's own sticky
          title/tabs chrome, see stickyTop) so it stays put on the page's
          vertical scroll too, while only the actual bid rows scroll past. */}
      <div className="sticky z-30 p-3 border-b border-slate-100 bg-slate-50/95 backdrop-blur-sm rounded-t-2xl" style={{ top: stickyTop }}>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
          {filterField(
            "Tag",
            <select
              value={filters.tag || ""}
              onChange={(e) => setFilters((f) => ({ ...f, tag: e.target.value }))}
              className="w-full bg-white border border-slate-200 rounded px-1.5 py-1 text-[10px]"
            >
              <option value="">All</option>
              {Object.keys(TAG_STYLES).map((t) => (
                <option key={t} value={t}>
                  {TAG_SHORT_LABELS[t] || t} — {t}
                </option>
              ))}
            </select>
          )}
          {filterField(
            "Bid No",
            <input
              value={filters.bidNo || ""}
              onChange={(e) => setFilters((f) => ({ ...f, bidNo: e.target.value }))}
              placeholder="Search..."
              className="w-full bg-white border border-slate-200 rounded px-1.5 py-1 text-[10px]"
            />
          )}
          {filterField(
            "Bid End Date/Time",
            <div className="flex gap-1">
              <input
                type="date"
                value={filters.bidEndDateTime?.from || ""}
                onChange={(e) => setFilters((f) => ({ ...f, bidEndDateTime: { ...(f.bidEndDateTime || {}), from: e.target.value } }))}
                className="w-full bg-white border border-slate-200 rounded px-1 py-1 text-[9px]"
              />
              <input
                type="date"
                value={filters.bidEndDateTime?.to || ""}
                onChange={(e) => setFilters((f) => ({ ...f, bidEndDateTime: { ...(f.bidEndDateTime || {}), to: e.target.value } }))}
                className="w-full bg-white border border-slate-200 rounded px-1 py-1 text-[9px]"
              />
            </div>
          )}
          {filterField(
            "Items",
            <input
              value={filters.items || ""}
              onChange={(e) => setFilters((f) => ({ ...f, items: e.target.value }))}
              placeholder="Search..."
              className="w-full bg-white border border-slate-200 rounded px-1.5 py-1 text-[10px]"
            />
          )}
          {filterField(
            "Address / Department",
            <input
              value={filters.addressOrDept || ""}
              onChange={(e) => setFilters((f) => ({ ...f, addressOrDept: e.target.value }))}
              placeholder="Search either..."
              className="w-full bg-white border border-slate-200 rounded px-1.5 py-1 text-[10px]"
            />
          )}
          {filterField(
            "Consignee City",
            <select
              value={filters.consigneeCity || ""}
              onChange={(e) => setFilters((f) => ({ ...f, consigneeCity: e.target.value }))}
              className="w-full bg-white border border-slate-200 rounded px-1.5 py-1 text-[10px]"
            >
              <option value="">All</option>
              {(dropdownOptions.consigneeCity || []).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Bid To RA / RA / Type of Bid / Evaluation are rarely filtered on -
            collapsed behind a toggle instead of always taking up a row.
            Document Required / EMD Amount / ATC search boxes were dropped
            entirely by request (their column still shows the data, just
            isn't searchable from here). */}
        <button
          type="button"
          onClick={() => setShowMoreFilters((v) => !v)}
          className="mt-2 text-[10px] font-black uppercase text-blue-600 hover:text-blue-800 tracking-wide"
        >
          {showMoreFilters ? "− Hide more filters" : "+ More filters (Bid To RA, RA, Type of Bid, Evaluation)"}
        </button>

        {showMoreFilters && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 mt-2">
            {filterField(
              "Bid To RA",
              <select
                value={filters.bidToRaEnabled || ""}
                onChange={(e) => setFilters((f) => ({ ...f, bidToRaEnabled: e.target.value }))}
                className="w-full bg-white border border-slate-200 rounded px-1.5 py-1 text-[10px]"
              >
                <option value="">All</option>
                {(dropdownOptions.bidToRaEnabled || []).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            )}
            {filterField(
              "RA",
              <select
                value={filters.raQualificationRule || ""}
                onChange={(e) => setFilters((f) => ({ ...f, raQualificationRule: e.target.value }))}
                className="w-full bg-white border border-slate-200 rounded px-1.5 py-1 text-[10px]"
              >
                <option value="">All</option>
                {(dropdownOptions.raQualificationRule || []).map((v) => (
                  <option key={v} value={v}>
                    {CELL_DISPLAY_FORMATTERS.raQualificationRule ? CELL_DISPLAY_FORMATTERS.raQualificationRule(v) : v}
                  </option>
                ))}
              </select>
            )}
            {filterField(
              "Type of Bid",
              <select
                value={filters.typeOfBid || ""}
                onChange={(e) => setFilters((f) => ({ ...f, typeOfBid: e.target.value }))}
                className="w-full bg-white border border-slate-200 rounded px-1.5 py-1 text-[10px]"
              >
                <option value="">All</option>
                {(dropdownOptions.typeOfBid || []).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            )}
            {filterField(
              "Evaluation",
              <select
                value={filters.evaluationMethod || ""}
                onChange={(e) => setFilters((f) => ({ ...f, evaluationMethod: e.target.value }))}
                className="w-full bg-white border border-slate-200 rounded px-1.5 py-1 text-[10px]"
              >
                <option value="">All</option>
                {(dropdownOptions.evaluationMethod || []).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      <div className="relative overflow-hidden rounded-b-2xl">
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
                Bid No / End Date{" "}
                {sort?.key === "bidNo" && (sort.dir === "asc" ? <FiChevronUp className="inline" size={10} /> : <FiChevronDown className="inline" size={10} />)}
              </th>
              {showSectionCol && <th className="py-2 px-2 whitespace-nowrap">Section</th>}
              {showBidStatusCol && (
                <th className="py-2 px-2 whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    Bid Status
                    <button
                      type="button"
                      disabled={refreshingStatuses}
                      onClick={refreshBidStatuses}
                      title="Fetch current status from GeM for every bid in this section"
                      className="flex items-center gap-1 bg-slate-700 hover:bg-slate-800 disabled:opacity-40 text-white font-black uppercase text-[8px] tracking-wide py-1 px-2 rounded normal-case"
                    >
                      <FiRefreshCw size={9} className={refreshingStatuses ? "animate-spin" : ""} />
                      {refreshingStatuses ? "Refreshing..." : "Refresh"}
                    </button>
                  </div>
                </th>
              )}
              {showPartyCol && <th className="py-2 px-2 whitespace-nowrap">Party</th>}
              {otherColumns.map((col) => (
                <th key={col.key} className="py-2 px-2 cursor-pointer whitespace-nowrap" onClick={() => toggleSort(col.key)}>
                  {MERGED_COLUMN_LABELS[col.key] || col.header}{" "}
                  {sort?.key === col.key && (sort.dir === "asc" ? <FiChevronUp className="inline" size={10} /> : <FiChevronDown className="inline" size={10} />)}
                </th>
              ))}
              <th className="py-2 px-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={otherColumns.length + 4 + extraColCount} className="text-center py-10 text-slate-400 text-xs font-bold uppercase tracking-widest">
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
                      {TAG_SHORT_LABELS[b.tag] || b.tag}
                    </button>
                  </td>
                  <td className="py-2 px-2 font-mono font-bold text-slate-700">
                    <div className="whitespace-nowrap">{b.bidNo}</div>
                    {b.bidEndDateTime && (
                      <div className="text-[10px] font-sans font-normal text-slate-400 whitespace-nowrap">
                        {b.bidEndDateTime}
                      </div>
                    )}
                    {/* Any per-bid badge (not just "Updated") belongs here,
                        stacked under the Bid No, rather than inline beside
                        it - inline badges were widening this column and
                        misaligning the row whenever one showed up. */}
                    {b.hasPendingUpdate && (
                      <span className="inline-block mt-1 bg-purple-50 border border-purple-200 text-purple-700 text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full whitespace-nowrap">
                        Updated
                      </span>
                    )}
                    {b.hasFieldConflict && (
                      <span
                        className="inline-block mt-1 ml-1 bg-rose-50 border border-rose-200 text-rose-700 text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full whitespace-nowrap"
                        title={(b.fieldConflicts || [])
                          .map((c: any) => `${c.field}: you set "${c.yourValue}", GeM now shows "${c.gemValue}"`)
                          .join(" | ")}
                      >
                        Conflict
                      </span>
                    )}
                  </td>
                  {showSectionCol && (
                    <td className="py-2 px-2">
                      <span className="border border-slate-200 bg-slate-50 text-slate-600 text-[9px] font-black uppercase px-2 py-0.5 rounded-full whitespace-nowrap">
                        {SECTIONS.find((s) => s.key === b.currentSection)?.label || b.currentSection}
                      </span>
                    </td>
                  )}
                  {showBidStatusCol && (
                    <td className="py-2 px-2">
                      <input
                        key={b.bidStatus || ""}
                        defaultValue={b.bidStatus || ""}
                        disabled={busy}
                        onBlur={(e) => {
                          if (e.target.value !== (b.bidStatus || "")) quickUpdate(b.bidNo, "bidStatus", e.target.value);
                        }}
                        placeholder="—"
                        className="bg-slate-50 border border-slate-200 rounded px-1.5 py-1 text-[10px] w-32"
                      />
                    </td>
                  )}
                  {showPartyCol && (
                    <td className="py-2 px-2">
                      <PartySelect
                        companies={companies}
                        selectedIds={b.selectedPartyIds || (b.selectedPartyId ? [b.selectedPartyId] : [])}
                        disabled={busy}
                        onChange={(ids) => quickUpdate(b.bidNo, "selectedPartyIds", ids)}
                      />
                      {b.lastModifiedBy && <span className="block text-[9px] text-slate-400 mt-0.5">by {b.lastModifiedBy}</span>}
                    </td>
                  )}
                  {otherColumns.map((col) => {
                    // Renders one of the three merged (stacked) cells - see
                    // STACKED_GROUPS/MERGED_COLUMN_LABELS above for why these keys.
                    const group = STACKED_GROUPS[col.key];
                    if (group) {
                      const matchedInstitute = col.key === "address" ? matchedInstituteByBidNo.get(b.bidNo) : undefined;
                      return (
                        <td key={col.key} className={`py-2 px-2 ${STACKED_CELL_MAX_WIDTH[col.key] || "max-w-[220px]"}`}>
                          {matchedInstitute && (
                            <div
                              className="text-emerald-700 font-black text-[10px] truncate"
                              title={`Matched via this institute's GeM Location (for auto-match) in Sellers`}
                            >
                              {matchedInstitute}
                            </div>
                          )}
                          {group.map((fieldKey, i) => {
                            if (LINK_COLUMNS.has(fieldKey)) {
                              const prefix = STACKED_LINK_PREFIX[fieldKey];
                              return (
                                <div key={fieldKey} className={i === 0 ? "" : "text-[10px]"}>
                                  {b[fieldKey] ? (
                                    <a href={b[fieldKey]} target="_blank" rel="noreferrer" className="text-blue-600 underline">
                                      {prefix ? `${prefix}: Link` : "Link"}
                                    </a>
                                  ) : prefix ? null : (
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
                      {EDITABLE_SECTIONS.has(effectiveSectionFor(b)) && (
                        <button
                          disabled={busy}
                          onClick={() => openEdit(b)}
                          title="Edit Bid"
                          className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition-colors disabled:opacity-40"
                        >
                          <FiEdit2 size={12} />
                        </button>
                      )}
                      {effectiveSectionFor(b) !== "fetched_bid_data" && (
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
        <div className="p-3 text-center border-t border-slate-100 rounded-b-2xl flex items-center justify-center gap-4">
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
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Bid No, Bid Link, Start Date, Bid End Date/Time, Items, QTY, Consignee City, Evaluation, and Bid To
                  RA/RA aren&apos;t editable here.
                </p>
              </div>
              <button onClick={() => setEditingBid(null)} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                <FiX size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {BID_COLUMNS.filter((c) => EDITABLE_FIELD_KEYS.includes(c.key)).map((col) =>
                col.key === "documentRequiredFromSeller" ? (
                  <div key={col.key} className="sm:col-span-2">
                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider block mb-1">
                      Document required from seller
                    </label>
                    <div className="border border-slate-200 rounded-lg p-2.5">
                      <div className="max-h-32 overflow-y-auto flex flex-wrap gap-1.5 mb-2">
                        {documentTypes.length === 0 ? (
                          <span className="text-[11px] text-slate-400">No document types saved yet — add one below.</span>
                        ) : (
                          documentTypes.map((type) => (
                            <label
                              key={type}
                              className={`flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-full border cursor-pointer ${
                                selectedDocTypes.has(type)
                                  ? "bg-blue-50 border-blue-300 text-blue-700"
                                  : "bg-slate-50 border-slate-200 text-slate-600"
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="hidden"
                                checked={selectedDocTypes.has(type)}
                                onChange={() => toggleDocType(type)}
                              />
                              {type}
                            </label>
                          ))
                        )}
                      </div>
                      <div className="flex gap-1.5">
                        <input
                          value={newDocTypeInput}
                          onChange={(e) => setNewDocTypeInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addDocType();
                            }
                          }}
                          placeholder="Add a new document type…"
                          className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                          type="button"
                          onClick={addDocType}
                          className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide bg-slate-200 hover:bg-slate-300 text-slate-700 transition-colors"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div key={col.key}>
                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider block mb-1">{col.header}</label>
                    <input
                      value={editValues[col.key] ?? ""}
                      onChange={(e) => setEditValues((v) => ({ ...v, [col.key]: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )
              )}
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
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Searchable multi-select for the Party column (Bids to Fill): a trigger
// button showing how many are picked, selected parties as removable chips
// below it, and a dropdown panel with a search box on top over the
// checkbox list - a plain <select multiple> (ctrl/cmd-click to multi-pick)
// worked but wasn't discoverable/searchable enough for a firm list that
// can run long, and had no obvious way to remove one selection at a time.
function PartySelect({
  companies,
  selectedIds,
  disabled,
  onChange,
}: {
  companies: Company[];
  selectedIds: string[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const selected = companies.filter((c) => selectedIds.includes(c._id));
  const query = search.trim().toLowerCase();
  const filtered = query
    ? companies.filter((c) => c.firmName.toLowerCase().includes(query) || (c.firmCode || "").toLowerCase().includes(query))
    : companies;

  const toggle = (id: string) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  };
  const remove = (id: string) => onChange(selectedIds.filter((x) => x !== id));

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="bg-slate-50 border border-slate-200 rounded px-1.5 py-1 text-[10px] font-bold min-w-[110px] max-w-[150px] text-left disabled:opacity-40 truncate"
      >
        {selected.length === 0 ? <span className="text-slate-400">Select party...</span> : `${selected.length} selected`}
      </button>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1 max-w-[150px]">
          {selected.map((c) => (
            <span
              key={c._id}
              className="flex items-center gap-0.5 bg-blue-50 border border-blue-200 text-blue-700 rounded-full pl-1.5 pr-0.5 py-0.5 text-[9px] font-bold max-w-full"
            >
              <span className="truncate">{c.firmName}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(c._id)}
                className="hover:bg-blue-200 rounded-full p-0.5 shrink-0"
                aria-label={`Remove ${c.firmName}`}
              >
                <FiX size={9} />
              </button>
            </span>
          ))}
        </div>
      )}
      {open && (
        <div className="absolute z-40 top-full left-0 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg p-2">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search party..."
            className="w-full border border-slate-200 rounded px-2 py-1 text-[11px] mb-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <div className="max-h-40 overflow-y-auto flex flex-col gap-0.5">
            {filtered.length === 0 ? (
              <span className="text-[10px] text-slate-400 px-1 py-1">No match</span>
            ) : (
              filtered.map((c) => (
                <label
                  key={c._id}
                  className="flex items-center gap-1.5 text-[11px] text-slate-700 px-1 py-1 hover:bg-slate-50 rounded cursor-pointer"
                >
                  <input type="checkbox" checked={selectedIds.includes(c._id)} onChange={() => toggle(c._id)} />
                  {c.firmName}
                  {c.firmCode ? ` (${c.firmCode})` : ""}
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
