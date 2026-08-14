"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { FiArrowLeft, FiLink, FiX, FiTrash2, FiSearch } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";

interface AdvanceSummaryRow {
  orderId: string;
  orderNo: string;
  firmCode: string;
  instituteName: string;
  itemName: string;
  contractDate: string;
  advanceQty: number;
  coveredQty: number;
  remainingQty: number;
  linkCount: number;
  status: "Not Covered" | "Partially Covered" | "Fully Covered";
}

interface LinkRow {
  _id: string;
  gemOrderNo: string;
  linkedQty: number;
  linkedBy: string;
  linkedAt: string;
}

interface CandidateOrder {
  _id: string;
  orderNo: string;
  itemId: string;
  itemName: string;
  instituteName: string;
  firmCode: string;
  reQty: number;
  isAdvanceOrder?: boolean;
}

const STATUS_STYLES: Record<string, string> = {
  "Not Covered": "bg-red-50 border-red-200 text-red-700",
  "Partially Covered": "bg-amber-50 border-amber-200 text-amber-700",
  "Fully Covered": "bg-emerald-50 border-emerald-200 text-emerald-700",
};
// "Fully Covered" is displayed as "Merged" - an advance order that's been fully
// auto-merged into real GeM order(s) reads as resolved, not just "covered."
const statusLabel = (status: string) => (status === "Fully Covered" ? "Merged" : status);

const formatQty = (n: number) => (n || 0).toLocaleString("en-IN");

export default function AdvanceOrderTrackerPage() {
  const [companies, setCompanies] = useState<any[]>([]);
  const [firmFilter, setFirmFilter] = useState("");
  const [search, setSearch] = useState("");
  const [showMerged, setShowMerged] = useState(false);
  const [summary, setSummary] = useState<AdvanceSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUsername, setCurrentUsername] = useState("");

  const [allOrders, setAllOrders] = useState<CandidateOrder[]>([]);
  const [activeRow, setActiveRow] = useState<AdvanceSummaryRow | null>(null);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [linksLoading, setLinksLoading] = useState(false);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [linkQty, setLinkQty] = useState<string>("");
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState("");

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

    fetch("/api/companies")
      .then((res) => res.json())
      .then((data) => setCompanies(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load firms", err));

    fetch("/api/seller-orders")
      .then((res) => res.json())
      .then((data) => setAllOrders(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load orders", err));
  }, []);

  const fetchSummary = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (firmFilter) params.set("firmCode", firmFilter);
    fetch(`/api/advance-order-links/summary?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => setSummary(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load advance order summary", err))
      .finally(() => setLoading(false));
  }, [firmFilter]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const filteredSummary = useMemo(() => {
    const q = search.trim().toLowerCase();
    return summary.filter((r) => {
      // "Fully Covered" advance orders are auto-merged and resolved — hide them from the
      // day-to-day view by default so this page only shows what still needs attention.
      if (!showMerged && r.status === "Fully Covered") return false;
      if (!q) return true;
      return (
        r.orderNo.toLowerCase().includes(q) ||
        r.instituteName.toLowerCase().includes(q) ||
        r.itemName.toLowerCase().includes(q)
      );
    });
  }, [summary, search, showMerged]);

  const openDrilldown = async (row: AdvanceSummaryRow) => {
    setActiveRow(row);
    setLinksLoading(true);
    setSelectedCandidateId("");
    setLinkQty("");
    setLinkError("");
    setCandidateSearch("");
    try {
      const res = await fetch(`/api/advance-order-links?advanceOrderId=${encodeURIComponent(row.orderId)}`);
      setLinks(await res.json());
    } catch (err) {
      console.error("Failed to load links", err);
    } finally {
      setLinksLoading(false);
    }
  };

  const candidateOrders = useMemo(() => {
    if (!activeRow) return [];
    const q = candidateSearch.trim().toLowerCase();
    return allOrders.filter((o) => {
      if (o.isAdvanceOrder) return false;
      if (o._id === activeRow.orderId) return false;
      if (o.instituteName !== activeRow.instituteName) return false;
      if (o.itemName !== activeRow.itemName) return false;
      if (!q) return true;
      return o.orderNo.toLowerCase().includes(q);
    });
  }, [allOrders, activeRow, candidateSearch]);

  const handleCreateLink = async () => {
    if (!activeRow || !selectedCandidateId) return;
    const qty = Number(linkQty);
    if (!qty || qty <= 0) {
      setLinkError("Enter a valid quantity greater than 0.");
      return;
    }
    setLinking(true);
    setLinkError("");
    try {
      const res = await fetch("/api/advance-order-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          advanceOrderId: activeRow.orderId,
          gemOrderId: selectedCandidateId,
          linkedQty: qty,
          linkedBy: currentUsername,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to link");
      setSelectedCandidateId("");
      setLinkQty("");
      fetchSummary();
      const linksRes = await fetch(`/api/advance-order-links?advanceOrderId=${encodeURIComponent(activeRow.orderId)}`);
      setLinks(await linksRes.json());
    } catch (err: any) {
      setLinkError(err.message || "Failed to link");
    } finally {
      setLinking(false);
    }
  };

  const handleUnlink = async (linkId: string) => {
    if (!activeRow) return;
    if (!confirm("Remove this link?")) return;
    try {
      const res = await fetch(`/api/advance-order-links/${linkId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to unlink");
      fetchSummary();
      const linksRes = await fetch(`/api/advance-order-links?advanceOrderId=${encodeURIComponent(activeRow.orderId)}`);
      setLinks(await linksRes.json());
    } catch (err: any) {
      alert(err.message || "Failed to unlink");
    }
  };

  return (
    <BlockGuard
      permission="advanceOrderTracker"
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
        <div className="max-w-7xl mx-auto flex flex-col gap-6">
          <div>
            <Link href="/dashboard/orders" className="flex items-center gap-2 text-slate-500 hover:text-blue-600 text-xs mb-2 transition-colors w-fit">
              <FiArrowLeft /> Back to Orders
            </Link>
            <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
              <FiLink className="text-amber-600" /> Advance Order Tracker
            </h1>
            <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mt-0.5">
              How Much of Each Advance Delivery Is Covered by Real GeM Orders
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
              <input
                type="text"
                placeholder="Search order no, institute, item..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pl-9 pr-3 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500 font-semibold"
              />
            </div>
            <select
              value={firmFilter}
              onChange={(e) => setFirmFilter(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-xs text-slate-700 focus:outline-none focus:border-blue-500 font-bold"
            >
              <option value="">All Firms</option>
              {companies.map((c) => (
                <option key={c._id} value={c.firmCode}>
                  {c.firmName} {c.firmCode ? `(${c.firmCode})` : ""}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 cursor-pointer">
              <input type="checkbox" checked={showMerged} onChange={(e) => setShowMerged(e.target.checked)} className="w-4 h-4 accent-emerald-600" />
              <span className="text-[11px] font-bold text-slate-600">Show Merged</span>
            </label>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            {loading ? (
              <div className="flex justify-center items-center py-16">
                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-blue-500"></div>
              </div>
            ) : filteredSummary.length === 0 ? (
              <div className="text-center py-16 text-slate-400 space-y-2">
                <FiLink className="mx-auto text-2xl text-slate-300" />
                <p className="text-xs uppercase font-black tracking-widest">
                  No Advance Orders yet — mark an order "Advance Order" in Add/Edit Order to see it here
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                      <th className="py-3 px-4">Order No</th>
                      <th className="py-3 px-4">Institute</th>
                      <th className="py-3 px-4">Item</th>
                      <th className="py-3 px-4 text-right">Advance Qty</th>
                      <th className="py-3 px-4 text-right">Covered Qty</th>
                      <th className="py-3 px-4 text-right">Remaining Qty</th>
                      <th className="py-3 px-4 text-center">Status</th>
                      <th className="py-3 px-4 text-center">Links</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredSummary.map((row) => (
                      <tr key={row.orderId} className="hover:bg-amber-50/40 transition-colors cursor-pointer" onClick={() => openDrilldown(row)}>
                        <td className="py-3 px-4 font-mono font-bold text-slate-700">{row.orderNo}</td>
                        <td className="py-3 px-4 text-slate-700">{row.instituteName}</td>
                        <td className="py-3 px-4 text-slate-600">{row.itemName}</td>
                        <td className="py-3 px-4 text-right font-mono">{formatQty(row.advanceQty)}</td>
                        <td className="py-3 px-4 text-right font-mono text-emerald-700">{formatQty(row.coveredQty)}</td>
                        <td className="py-3 px-4 text-right font-mono text-red-600 font-bold">{formatQty(row.remainingQty)}</td>
                        <td className="py-3 px-4 text-center">
                          <span className={`border text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${STATUS_STYLES[row.status]}`}>
                            {statusLabel(row.status)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-slate-500">{row.linkCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {activeRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden shadow-2xl flex flex-col">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">{activeRow.orderNo}</h3>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">
                  {activeRow.instituteName} · {activeRow.itemName} · Advance {formatQty(activeRow.advanceQty)}, Remaining {formatQty(activeRow.remainingQty)}
                </p>
              </div>
              <button onClick={() => setActiveRow(null)} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                <FiX size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <div>
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider block mb-2">Linked GeM Orders</span>
                {linksLoading ? (
                  <div className="flex justify-center py-6">
                    <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-blue-500"></div>
                  </div>
                ) : links.length === 0 ? (
                  <p className="text-[11px] text-slate-400">No GeM orders linked yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {links.map((l) => (
                      <div key={l._id} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                        <div>
                          <span className="font-mono font-bold text-slate-700 text-[11px]">{l.gemOrderNo}</span>
                          <span className="text-[10px] text-slate-400 ml-2">
                            {l.linkedBy || "—"} · {new Date(l.linkedAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-black text-emerald-700 text-[11px]">{formatQty(l.linkedQty)}</span>
                          <button onClick={() => handleUnlink(l._id)} title="Unlink" className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition-colors">
                            <FiTrash2 size={11} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
                <span className="text-[10px] font-black uppercase text-amber-700 tracking-wider block">Link a GeM Order</span>
                <input
                  type="text"
                  placeholder="Search GeM order no (same institute + item)..."
                  value={candidateSearch}
                  onChange={(e) => setCandidateSearch(e.target.value)}
                  className="w-full bg-white border border-amber-200 rounded-lg py-2 px-3 text-xs focus:outline-none focus:border-amber-500"
                />
                <select
                  value={selectedCandidateId}
                  onChange={(e) => setSelectedCandidateId(e.target.value)}
                  className="w-full bg-white border border-amber-200 rounded-lg py-2 px-3 text-xs font-bold focus:outline-none focus:border-amber-500"
                >
                  <option value="">Select a GeM order...</option>
                  {candidateOrders.map((o) => (
                    <option key={o._id} value={o._id}>
                      {o.orderNo} — Qty {o.reQty}
                    </option>
                  ))}
                </select>
                {candidateOrders.length === 0 && (
                  <p className="text-[10px] text-amber-600">
                    No eligible GeM orders found for this institute + item (excludes other Advance Orders).
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    placeholder="Qty to link"
                    value={linkQty}
                    onChange={(e) => setLinkQty(e.target.value)}
                    className="flex-1 bg-white border border-amber-200 rounded-lg py-2 px-3 text-xs font-mono focus:outline-none focus:border-amber-500"
                  />
                  <button
                    disabled={linking || !selectedCandidateId}
                    onClick={handleCreateLink}
                    className="bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white font-black uppercase text-[10px] tracking-wide py-2.5 px-4 rounded-lg transition-colors"
                  >
                    {linking ? "Linking..." : "Link"}
                  </button>
                </div>
                {linkError && <p className="text-[11px] text-red-600 font-bold">{linkError}</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </BlockGuard>
  );
}
