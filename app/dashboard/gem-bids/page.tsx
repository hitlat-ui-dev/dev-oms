"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import * as XLSX from "xlsx";
import Link from "next/link";
import { FiArrowLeft, FiUploadCloud, FiX, FiLayers } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";
import GemBidTable, { GemBid } from "@/components/GemBidTable";
import { HEADER_TO_FIELD, DATA_FIELD_KEYS, SECTIONS, SectionKey } from "@/lib/gemBids/columns";

interface ChangeHistoryRow {
  fieldChanged: string;
  oldValue: string;
  newValue: string;
  runTimestamp: string;
}
interface MoveHistoryRow {
  fromSection: string;
  toSection: string;
  movedBy: string;
  movedAt: string;
  isReversal: boolean;
}

export default function GemBidsPage() {
  const [bids, setBids] = useState<GemBid[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<SectionKey>(SECTIONS[0].key);
  const [currentUsername, setCurrentUsername] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ newCount: number; updatedCount: number; oldCount: number } | null>(null);

  const [historyBidNo, setHistoryBidNo] = useState<string | null>(null);
  const [changeHistory, setChangeHistory] = useState<ChangeHistoryRow[]>([]);
  const [moveHistory, setMoveHistory] = useState<MoveHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

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

  const fetchBids = useCallback(() => {
    setLoading(true);
    fetch("/api/gem-bids")
      .then((res) => res.json())
      .then((data) => setBids(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load GeM bids", err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchBids();
  }, [fetchBids]);

  const sectionCounts = useMemo(() => {
    const map: Record<string, number> = {};
    SECTIONS.forEach((s) => (map[s.key] = 0));
    bids.forEach((b) => {
      map[b.currentSection] = (map[b.currentSection] || 0) + 1;
    });
    return map;
  }, [bids]);

  const bidsInActiveSection = useMemo(() => bids.filter((b) => b.currentSection === activeSection), [bids, activeSection]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const workbook = XLSX.read(bstr, { type: "binary" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
        if (rawRows.length < 2) throw new Error("No data rows found in this file.");

        const headerRow: string[] = rawRows[0].map((h: any) => String(h || "").trim());
        const colIndexByField: Record<string, number> = {};
        headerRow.forEach((h, idx) => {
          const field = HEADER_TO_FIELD[h];
          if (field) colIndexByField[field] = idx;
        });
        if (colIndexByField.bidNo === undefined) {
          throw new Error('Could not find a "Bid No" column — check this is a genuine GeM Bid Exporter export.');
        }

        const rows = rawRows
          .slice(1)
          .filter((r) => r.some((c: any) => String(c || "").trim() !== ""))
          .map((r) => {
            const obj: Record<string, string> = {};
            for (const key of ["bidNo", ...DATA_FIELD_KEYS]) {
              const idx = colIndexByField[key];
              obj[key] = idx !== undefined ? String(r[idx] ?? "").trim() : "";
            }
            return obj;
          })
          .filter((r) => r.bidNo);

        if (rows.length === 0) throw new Error("No valid Bid No rows found in this file.");

        const res = await fetch("/api/gem-bids/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows, fileName: file.name, userName: currentUsername }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Import failed");
        setImportResult(data);
        fetchBids();
      } catch (err: any) {
        alert(err.message || "Failed to import file");
      } finally {
        setImporting(false);
        e.target.value = "";
      }
    };
    reader.readAsBinaryString(file);
  };

  const openHistory = async (bidNo: string) => {
    setHistoryBidNo(bidNo);
    setHistoryLoading(true);
    try {
      const [chRes, mhRes] = await Promise.all([
        fetch(`/api/gem-bids/change-history?bidNo=${encodeURIComponent(bidNo)}`),
        fetch(`/api/gem-bids/move-history?bidNo=${encodeURIComponent(bidNo)}`),
      ]);
      setChangeHistory(await chRes.json());
      setMoveHistory(await mhRes.json());
    } catch (err) {
      console.error("Failed to load history", err);
    } finally {
      setHistoryLoading(false);
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
        <div className="max-w-[1600px] mx-auto flex flex-col gap-6">
          <div>
            <Link href="/dashboard" className="flex items-center gap-2 text-slate-500 hover:text-blue-600 text-xs mb-2 transition-colors w-fit">
              <FiArrowLeft /> Back to Dashboard
            </Link>
            <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
              <FiLayers className="text-blue-600" /> GeM Bids
            </h1>
            <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mt-0.5">
              Fetch, Track & Work GeM Bid Listings
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5 mb-3">
              <FiUploadCloud className="text-blue-600" size={14} /> Fetch Latest from GeM
            </h3>
            <label className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-black uppercase text-xs tracking-wider py-3 px-6 rounded-xl cursor-pointer transition-all">
              <FiUploadCloud size={14} /> {importing ? "Importing..." : "Upload Latest Export (.xlsx)"}
              <input type="file" accept=".xlsx,.xls" className="hidden" disabled={importing} onChange={handleFile} />
            </label>
            <p className="text-[10px] text-slate-400 mt-2">
              Upload the GeM Bid Exporter's latest .xlsx export — bids are matched by Bid No and
              tagged New Published / Old / Updated-Extended.
            </p>
            {importResult && (
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold">
                <span className="bg-blue-50 border border-blue-200 text-blue-700 px-2 py-1 rounded-full">
                  {importResult.newCount} New Published
                </span>
                <span className="bg-amber-50 border border-amber-200 text-amber-700 px-2 py-1 rounded-full">
                  {importResult.updatedCount} Updated/Extended
                </span>
                <span className="bg-slate-50 border border-slate-200 text-slate-600 px-2 py-1 rounded-full">
                  {importResult.oldCount} Old
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 w-fit">
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                onClick={() => setActiveSection(s.key)}
                className={`px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wide transition-colors ${
                  activeSection === s.key ? "bg-blue-600 text-white shadow" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {s.label} <span className="ml-1 opacity-70">({sectionCounts[s.key] || 0})</span>
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex justify-center items-center py-16">
              <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-blue-500"></div>
            </div>
          ) : (
            <GemBidTable bids={bidsInActiveSection} currentUsername={currentUsername} onMoved={fetchBids} onViewHistory={openHistory} />
          )}
        </div>
      </div>

      {historyBidNo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden shadow-2xl flex flex-col">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">History — {historyBidNo}</h3>
              <button onClick={() => setHistoryBidNo(null)} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                <FiX size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {historyLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-blue-500"></div>
                </div>
              ) : (
                <>
                  <div>
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider block mb-2">Field Changes</span>
                    {changeHistory.length === 0 ? (
                      <p className="text-[11px] text-slate-400">No field changes recorded.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {changeHistory.map((c, i) => (
                          <div key={i} className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-[11px]">
                            <span className="font-black text-slate-700">{c.fieldChanged}</span>
                            <span className="text-slate-400"> — </span>
                            <span className="text-red-500 line-through">{c.oldValue || "(blank)"}</span>
                            <span className="text-slate-400"> → </span>
                            <span className="text-emerald-600 font-bold">{c.newValue || "(blank)"}</span>
                            <span className="block text-[9px] text-slate-400 mt-1">{new Date(c.runTimestamp).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider block mb-2">Section Moves</span>
                    {moveHistory.length === 0 ? (
                      <p className="text-[11px] text-slate-400">No moves recorded.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {moveHistory.map((m, i) => (
                          <div key={i} className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-[11px]">
                            <span className="font-bold text-slate-700">{m.fromSection}</span>
                            <span className="text-slate-400"> → </span>
                            <span className="font-bold text-slate-700">{m.toSection}</span>
                            {m.isReversal && <span className="ml-2 text-[9px] text-amber-600 font-black uppercase">Send Back</span>}
                            <span className="block text-[9px] text-slate-400 mt-1">
                              {m.movedBy || "—"} · {new Date(m.movedAt).toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </BlockGuard>
  );
}
