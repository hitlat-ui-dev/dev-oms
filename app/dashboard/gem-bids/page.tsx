"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { FiArrowLeft, FiX, FiLayers, FiFileText } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";
import GemBidTable, { GemBid } from "@/components/GemBidTable";
import { SECTIONS, SectionKey, SUBMITTED_STATUSES } from "@/lib/gemBids/columns";

interface LastRun {
  runAt: string;
  newCount: number;
  updatedCount: number;
  oldCount: number;
  excludedCount?: number;
  promotedCount?: number;
  expiredDeletedCount?: number;
}

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

interface SyncRun {
  _id: string;
  status: "scraping" | "stopped" | "discarded" | "applying" | "completed";
  progressPercent: number;
  phase?: string;
  startedAt: string;
  finishedAt?: string | null;
}

export default function GemBidsPage() {
  const [bids, setBids] = useState<GemBid[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<SectionKey>(SECTIONS[0].key);
  const [currentUsername, setCurrentUsername] = useState("");

  const [historyBidNo, setHistoryBidNo] = useState<string | null>(null);
  const [changeHistory, setChangeHistory] = useState<ChangeHistoryRow[]>([]);
  const [moveHistory, setMoveHistory] = useState<MoveHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);

  const [syncRun, setSyncRun] = useState<SyncRun | null>(null);
  const [syncActionLoading, setSyncActionLoading] = useState(false);
  const [resumePrompt, setResumePrompt] = useState<SyncRun | null>(null);

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

  const fetchLastRun = useCallback(() => {
    fetch("/api/gem-bids/last-run")
      .then((res) => res.json())
      .then((data) => setLastRun(data || null))
      .catch((err) => console.error("Failed to load last sync run", err));
  }, []);

  const fetchSyncStatus = useCallback(() => {
    fetch("/api/gem-bids/sync/status")
      .then((res) => res.json())
      .then((data) => setSyncRun(data?.run || null))
      .catch((err) => console.error("Failed to load sync status", err));
  }, []);

  const refetchAll = useCallback(() => {
    fetchBids();
    fetchLastRun();
    fetchSyncStatus();
  }, [fetchBids, fetchLastRun, fetchSyncStatus]);

  useEffect(() => {
    refetchAll();
  }, [refetchAll]);

  // Poll every ~2s while a run is actively scraping/applying so the
  // progress bar below moves live; stop polling once it settles into a
  // terminal state, and pull fresh bids + last-run stats the moment it
  // completes so newly-synced bids show up without a manual refresh.
  useEffect(() => {
    if (syncRun?.status !== "scraping" && syncRun?.status !== "applying") return;
    const interval = setInterval(() => {
      fetch("/api/gem-bids/sync/status?runId=" + syncRun._id)
        .then((res) => res.json())
        .then((data) => {
          const run: SyncRun | null = data?.run || null;
          setSyncRun(run);
          if (run?.status === "completed") {
            fetchBids();
            fetchLastRun();
          }
        })
        .catch((err) => console.error("Failed to poll sync status", err));
    }, 2000);
    return () => clearInterval(interval);
  }, [syncRun?.status, syncRun?._id, fetchBids, fetchLastRun]);

  const handleStartSync = async (resolution?: "keep" | "discard") => {
    setSyncActionLoading(true);
    try {
      const res = await fetch("/api/gem-bids/sync/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startedBy: currentUsername, resolution }),
      });
      const data = await res.json();
      if (res.status === 409 && data.needsResolution) {
        setResumePrompt(data.previousRun);
        return;
      }
      setResumePrompt(null);
      fetchSyncStatus();
    } catch (err) {
      console.error("Failed to start sync", err);
    } finally {
      setSyncActionLoading(false);
    }
  };

  const handleStopSync = async () => {
    if (!syncRun) return;
    setSyncActionLoading(true);
    try {
      await fetch("/api/gem-bids/sync/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: syncRun._id }),
      });
      fetchSyncStatus();
    } catch (err) {
      console.error("Failed to stop sync", err);
    } finally {
      setSyncActionLoading(false);
    }
  };

  const sectionCounts = useMemo(() => {
    const map: Record<string, number> = {};
    SECTIONS.forEach((s) => (map[s.key] = 0));
    bids.forEach((b) => {
      map[b.currentSection] = (map[b.currentSection] || 0) + 1;
    });
    return map;
  }, [bids]);

  const submittedStatusCounts = useMemo(() => {
    const map: Record<string, number> = {};
    SUBMITTED_STATUSES.forEach((s) => (map[s] = 0));
    bids
      .filter((b) => b.currentSection === "submitted_bids")
      .forEach((b) => {
        const status = b.submittedStatus || "Active";
        map[status] = (map[status] || 0) + 1;
      });
    return map;
  }, [bids]);

  const bidsInActiveSection = useMemo(() => bids.filter((b) => b.currentSection === activeSection), [bids, activeSection]);

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
          <div className="flex flex-wrap items-start justify-between gap-3">
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
            <div className="flex items-center gap-2">
              {syncRun?.status === "scraping" || syncRun?.status === "applying" ? (
                <button
                  onClick={handleStopSync}
                  disabled={syncActionLoading}
                  className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-black uppercase text-[11px] tracking-wide py-2.5 px-4 rounded-xl transition-colors"
                >
                  Stop Sync
                </button>
              ) : (
                <button
                  onClick={() => handleStartSync()}
                  disabled={syncActionLoading}
                  className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-black uppercase text-[11px] tracking-wide py-2.5 px-4 rounded-xl transition-colors"
                >
                  Start Sync
                </button>
              )}
              <Link
                href="/dashboard/gem-bids/document-maker"
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white font-black uppercase text-[11px] tracking-wide py-2.5 px-4 rounded-xl transition-colors"
              >
                <FiFileText size={13} /> Open Document Maker →
              </Link>
            </div>
          </div>

          {/* Dashboard / summary panel */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
              {SECTIONS.map((s) => (
                <div key={s.key} className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                  <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block">{s.label}</span>
                  <span className="text-lg font-black text-slate-800 block mt-0.5">{sectionCounts[s.key] || 0}</span>
                </div>
              ))}
            </div>

            {sectionCounts["submitted_bids"] > 0 && (
              <div className="mb-4">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-1.5">Submitted Bids — by status</span>
                <div className="flex flex-wrap gap-2">
                  {SUBMITTED_STATUSES.map((s) => (
                    <span key={s} className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-[10px] font-bold text-slate-600">
                      {s}: <span className="text-slate-900 font-black">{submittedStatusCounts[s] || 0}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {(syncRun?.status === "scraping" || syncRun?.status === "applying") && (
              <div className="mb-4 pt-3 border-t border-slate-100">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-black uppercase text-blue-600 tracking-wider">
                    {syncRun.status === "applying" ? "Applying..." : "Syncing..."}
                  </span>
                  <span className="text-[10px] font-bold text-slate-500">{syncRun.progressPercent ?? 0}%</span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all"
                    style={{ width: `${syncRun.progressPercent ?? 0}%` }}
                  />
                </div>
                <p className="text-[10px] text-slate-400 mt-1.5">
                  {syncRun.phase === "starting"
                    ? "Waiting for the extension to pick this up — keep the GeM Advance Search results tab open."
                    : syncRun.phase}
                </p>
              </div>
            )}

            {lastRun && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-bold text-slate-500 pt-3 border-t border-slate-100">
                <span>
                  Last sync: <span className="text-slate-800">{new Date(lastRun.runAt).toLocaleString()}</span>
                </span>
                <span>
                  Excluded: <span className="text-slate-800">{lastRun.excludedCount ?? 0}</span>
                </span>
                <span>
                  Auto-deleted (expired): <span className="text-slate-800">{lastRun.expiredDeletedCount ?? 0}</span>
                </span>
                <span>
                  Promoted to Fetched: <span className="text-slate-800">{lastRun.promotedCount ?? 0}</span>
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

      {resumePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-2xl p-5">
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-900 mb-2">Resume previous run?</h3>
            <p className="text-[11px] text-slate-500 mb-4">
              A sync run was stopped mid-way at {resumePrompt.progressPercent ?? 0}% (started{" "}
              {new Date(resumePrompt.startedAt).toLocaleString()}). Keep resuming it, or discard it and start fresh?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setResumePrompt(null);
                  handleStartSync("discard");
                }}
                className="px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wide bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
              >
                Discard, Start Fresh
              </button>
              <button
                onClick={() => {
                  setResumePrompt(null);
                  handleStartSync("keep");
                }}
                className="px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wide bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                Keep, Resume
              </button>
            </div>
          </div>
        </div>
      )}

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
