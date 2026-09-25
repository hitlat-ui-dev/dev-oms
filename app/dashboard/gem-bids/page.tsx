"use client";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { FiArrowLeft, FiX, FiLayers, FiFileText, FiPercent } from "react-icons/fi";
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
  // Section counts / last-sync info panel - collapsed by default to save
  // space; a live sync's progress bar still shows regardless (see below).
  const [showSummary, setShowSummary] = useState(false);

  // Sticky chrome: the global <header> (see components/Header.tsx, already
  // sticky top-0) plus this page's own title/tabs row need their combined
  // rendered height so the filter panel further down (inside GemBidTable)
  // knows how far below the viewport top it should stick, instead of
  // sitting underneath them. Measured live via ResizeObserver rather than
  // hardcoded, since both rows wrap differently across breakpoints.
  const chromeRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [stickyTop, setStickyTop] = useState(0);

  useEffect(() => {
    const headerEl = document.querySelector("header");
    const chromeEl = chromeRef.current;
    if (!headerEl || !chromeEl) return;

    const recompute = () => {
      const hH = headerEl.getBoundingClientRect().height;
      const cH = chromeEl.getBoundingClientRect().height;
      setHeaderHeight(hH);
      setStickyTop(hH + cH);
    };
    recompute();

    const ro = new ResizeObserver(recompute);
    ro.observe(headerEl);
    ro.observe(chromeEl);
    window.addEventListener("resize", recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, []);

  // Filters picked in the Start Sync modal below, sent to /sync/start and
  // read back by the extension's background worker to drive GeM's own
  // Consignee State/City/Date fields — this replaces having to open the
  // extension's popup and set them there before every run.
  const [startSyncModalOpen, setStartSyncModalOpen] = useState(false);
  const [filterState, setFilterState] = useState("Gujarat");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // City checkboxes: options come from a per-state cache the extension
  // fills in (bidplus.gem.gov.in can't be reached directly from the OMS
  // server — see /api/gem-bids/cities). "All Cities" checked (the default)
  // means "no city filter", i.e. search the whole state, same as leaving
  // the old free-text box blank.
  const [cityOptions, setCityOptions] = useState<string[]>([]);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [allCitiesSelected, setAllCitiesSelected] = useState(true);
  const [customCityInput, setCustomCityInput] = useState("");

  // Exclude-keyword list: persisted on the server (not per-browser like the
  // extension popup's own copy of this field) so it's the same list no
  // matter who clicks Start Sync, and keeps growing as words are added.
  const [excludeKeywords, setExcludeKeywords] = useState<string[]>([]);
  const [newKeywordInput, setNewKeywordInput] = useState("");
  const [keywordsSaving, setKeywordsSaving] = useState(false);

  useEffect(() => {
    if (!startSyncModalOpen) return;
    fetch("/api/gem-bids/exclude-keywords")
      .then((res) => res.json())
      .then((data) => setExcludeKeywords(Array.isArray(data?.keywords) ? data.keywords : []))
      .catch((err) => console.error("Failed to load exclude keywords", err));
  }, [startSyncModalOpen]);

  useEffect(() => {
    if (!startSyncModalOpen) return;
    const state = filterState.trim();
    if (!state) {
      setCityOptions([]);
      return;
    }
    setCitiesLoading(true);
    fetch(`/api/gem-bids/cities?state=${encodeURIComponent(state)}`)
      .then((res) => res.json())
      .then((data) => {
        setCityOptions(Array.isArray(data?.cities) ? data.cities : []);
        setSelectedCities([]);
        setAllCitiesSelected(true);
      })
      .catch((err) => console.error("Failed to load city cache", err))
      .finally(() => setCitiesLoading(false));
  }, [startSyncModalOpen, filterState]);

  const toggleCity = (city: string) => {
    setSelectedCities((prev) => (prev.includes(city) ? prev.filter((c) => c !== city) : [...prev, city]));
    setAllCitiesSelected(false);
  };

  const addCustomCity = () => {
    const city = customCityInput.trim();
    if (!city) return;
    if (!cityOptions.includes(city)) setCityOptions((prev) => [...prev, city]);
    setSelectedCities((prev) => (prev.includes(city) ? prev : [...prev, city]));
    setAllCitiesSelected(false);
    setCustomCityInput("");
  };

  const saveExcludeKeywords = async (next: string[]) => {
    setExcludeKeywords(next);
    setKeywordsSaving(true);
    try {
      await fetch("/api/gem-bids/exclude-keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords: next }),
      });
    } catch (err) {
      console.error("Failed to save exclude keywords", err);
    } finally {
      setKeywordsSaving(false);
    }
  };

  const addExcludeKeyword = () => {
    const word = newKeywordInput.trim();
    if (!word || excludeKeywords.some((k) => k.toLowerCase() === word.toLowerCase())) {
      setNewKeywordInput("");
      return;
    }
    saveExcludeKeywords([...excludeKeywords, word]);
    setNewKeywordInput("");
  };

  const removeExcludeKeyword = (word: string) => {
    saveExcludeKeywords(excludeKeywords.filter((k) => k !== word));
  };

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
        body: JSON.stringify({
          startedBy: currentUsername,
          resolution,
          filterState: filterState.trim() || "Gujarat",
          filterCities: allCitiesSelected ? [] : selectedCities,
          dateFrom: dateFrom.trim(),
          dateTo: dateTo.trim(),
          filterExcludeKeywords: excludeKeywords,
        }),
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
      <div className="p-3 md:p-5 bg-slate-50 min-h-screen">
        <div className="max-w-[1600px] mx-auto flex flex-col gap-3">
          {/* Sticky chrome: title/buttons row, the stats toggle, and the section
              tabs all stay pinned right below the global header while the table
              scrolls underneath. Height is measured live (see the ResizeObserver
              effect above) so the filter panel further down (inside GemBidTable)
              knows exactly how far below the viewport top to stick itself. */}
          <div ref={chromeRef} className="sticky z-40 bg-slate-50 flex flex-col gap-3 pb-2" style={{ top: headerHeight }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <Link href="/dashboard" className="flex items-center gap-1 text-slate-500 hover:text-blue-600 text-xs transition-colors w-fit">
                  <FiArrowLeft />
                </Link>
                <h1 className="text-base font-black uppercase tracking-tight text-slate-900 flex items-center gap-1.5">
                  <FiLayers className="text-blue-600" size={16} /> GeM Bids
                </h1>
              </div>
              <div className="flex items-center gap-2">
                {syncRun?.status === "scraping" || syncRun?.status === "applying" ? (
                  <button
                    onClick={handleStopSync}
                    disabled={syncActionLoading}
                    className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-black uppercase text-[11px] tracking-wide py-2 px-3.5 rounded-xl transition-colors"
                  >
                    Stop Sync
                  </button>
                ) : (
                  <button
                    onClick={() => setStartSyncModalOpen(true)}
                    disabled={syncActionLoading}
                    className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-black uppercase text-[11px] tracking-wide py-2 px-3.5 rounded-xl transition-colors"
                  >
                    Start Sync
                  </button>
                )}
                <Link
                  href="/dashboard/gem-bids/rate-variant-tool"
                  className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white font-black uppercase text-[11px] tracking-wide py-2 px-3.5 rounded-xl transition-colors"
                >
                  <FiPercent size={13} /> Rate Variant Tool →
                </Link>
                <Link
                  href="/dashboard/gem-bids/document-maker"
                  className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white font-black uppercase text-[11px] tracking-wide py-2 px-3.5 rounded-xl transition-colors"
                >
                  <FiFileText size={13} /> Open Document Maker →
                </Link>
              </div>
            </div>

            <button
              onClick={() => setShowSummary((v) => !v)}
              className="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-500 hover:text-blue-600 tracking-wide w-fit"
            >
              {showSummary ? "− Hide stats" : "+ Show stats (section counts, last sync)"}
            </button>

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
          </div>

          {/* A running sync's progress always shows - it's transient, actionable
              state, not something to bury behind a toggle. Everything else
              (section counts, last-sync info) is collapsed by default and
              only takes up space once asked for, via the toggle above - both
              scroll away normally rather than staying pinned, so they don't
              eat into the sticky chrome's height. */}
          {(syncRun?.status === "scraping" || syncRun?.status === "applying") && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-3">
              <div className="flex items-center justify-between mb-1">
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
              <p className="text-[10px] text-slate-400 mt-1">
                {syncRun.phase === "starting"
                  ? "Waiting for the GeM Bid Exporter extension to pick this up (checks about once a minute) — it'll open the GeM Advance Search page on its own and apply the filters you picked."
                  : syncRun.phase}
              </p>
            </div>
          )}

          {showSummary && (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-2">
              {SECTIONS.map((s) => (
                <div key={s.key} className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
                  <span className="text-[8px] font-black uppercase text-slate-400 tracking-wider block">{s.label}</span>
                  <span className="text-sm font-black text-slate-800 block">{sectionCounts[s.key] || 0}</span>
                </div>
              ))}
            </div>

            {sectionCounts["submitted_bids"] > 0 && (
              <div className="mb-2">
                <span className="text-[8px] font-black uppercase text-slate-400 tracking-wider block mb-1">Submitted Bids — by status</span>
                <div className="flex flex-wrap gap-1.5">
                  {SUBMITTED_STATUSES.map((s) => (
                    <span key={s} className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-0.5 text-[10px] font-bold text-slate-600">
                      {s}: <span className="text-slate-900 font-black">{submittedStatusCounts[s] || 0}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {lastRun && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-bold text-slate-500 pt-2 border-t border-slate-100">
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
          )}

          {loading ? (
            <div className="flex justify-center items-center py-16">
              <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-blue-500"></div>
            </div>
          ) : (
            <GemBidTable
              bids={bidsInActiveSection}
              currentUsername={currentUsername}
              onBidsUpdated={setBids}
              onViewHistory={openHistory}
              stickyTop={stickyTop}
            />
          )}
        </div>
      </div>

      {startSyncModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-2xl p-5">
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-900 mb-1">Start Sync — GeM filters</h3>
            <p className="text-[11px] text-slate-500 mb-4">
              The GeM Bid Exporter extension will open GeM&apos;s Advance Search page on its own and apply these
              before scraping.
            </p>
            <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider block mb-1">Consignee State</label>
            <input
              list="gemStateOptions"
              value={filterState}
              onChange={(e) => setFilterState(e.target.value)}
              placeholder="e.g. Gujarat"
              className="w-full mb-3 border border-slate-200 rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <datalist id="gemStateOptions">
              {[
                "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Delhi", "Goa", "Gujarat",
                "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra",
                "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim",
                "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
              ].map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider block mb-1">
              Consignee Cities
            </label>
            <div className="mb-3 border border-slate-200 rounded-lg overflow-hidden">
              <label className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 bg-slate-50 cursor-pointer text-[12px] font-bold text-slate-700">
                <input
                  type="checkbox"
                  checked={allCitiesSelected}
                  onChange={(e) => {
                    setAllCitiesSelected(e.target.checked);
                    if (e.target.checked) setSelectedCities([]);
                  }}
                />
                All Cities in {filterState.trim() || "the state"}
              </label>
              <div className="max-h-36 overflow-y-auto px-3 py-2">
                {citiesLoading ? (
                  <p className="text-[11px] text-slate-400">Loading cities…</p>
                ) : cityOptions.length === 0 ? (
                  <p className="text-[11px] text-slate-400">
                    No cities cached yet for this state — open the extension popup and click &quot;Load All Cities
                    From GeM&quot; once, or add one below.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                    {cityOptions.map((city) => (
                      <label key={city} className="flex items-center gap-1.5 text-[12px] text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!allCitiesSelected && selectedCities.includes(city)}
                          disabled={allCitiesSelected}
                          onChange={() => toggleCity(city)}
                        />
                        {city}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-1.5 px-3 py-2 border-t border-slate-100 bg-slate-50">
                <input
                  value={customCityInput}
                  onChange={(e) => setCustomCityInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustomCity();
                    }
                  }}
                  placeholder="Add a city not in the list…"
                  className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={addCustomCity}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide bg-slate-200 hover:bg-slate-300 text-slate-700 transition-colors"
                >
                  Add
                </button>
              </div>
            </div>
            <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider block mb-1">
              Bid Start Date range (optional, best-effort)
            </label>
            <div className="flex gap-2 mb-4">
              <input
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                placeholder="From: dd-mm-yyyy"
                className="w-1/2 border border-slate-200 rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                placeholder="To: dd-mm-yyyy"
                className="w-1/2 border border-slate-200 rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider block mb-1">
              Skip bids whose Items contain (saved, reused every time)
            </label>
            <div className="mb-4 border border-slate-200 rounded-lg p-2.5">
              <div className="flex flex-wrap gap-1.5 mb-2 min-h-[22px]">
                {excludeKeywords.length === 0 ? (
                  <span className="text-[11px] text-slate-400">No words excluded yet.</span>
                ) : (
                  excludeKeywords.map((word) => (
                    <span
                      key={word}
                      className="flex items-center gap-1 bg-red-50 border border-red-200 text-red-700 rounded-full pl-2.5 pr-1 py-0.5 text-[11px] font-bold"
                    >
                      {word}
                      <button
                        onClick={() => removeExcludeKeyword(word)}
                        className="hover:bg-red-200 rounded-full p-0.5 transition-colors"
                        aria-label={`Remove ${word}`}
                      >
                        <FiX size={11} />
                      </button>
                    </span>
                  ))
                )}
              </div>
              <div className="flex gap-1.5">
                <input
                  value={newKeywordInput}
                  onChange={(e) => setNewKeywordInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addExcludeKeyword();
                    }
                  }}
                  placeholder="e.g. catering"
                  className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={addExcludeKeyword}
                  disabled={keywordsSaving}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide bg-slate-200 hover:bg-slate-300 disabled:opacity-60 text-slate-700 transition-colors"
                >
                  Add
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setStartSyncModalOpen(false)}
                className="px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wide bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setStartSyncModalOpen(false);
                  handleStartSync();
                }}
                disabled={syncActionLoading}
                className="px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wide bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white transition-colors"
              >
                Start Sync
              </button>
            </div>
          </div>
        </div>
      )}

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
