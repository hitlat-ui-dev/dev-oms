"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  FiArrowLeft,
  FiCheckSquare,
  FiCheckCircle,
  FiXCircle,
  FiRotateCcw,
  FiInfo,
  FiRefreshCw,
  FiX,
  FiAlertTriangle,
} from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";

interface Match {
  _id: string;
  firmCode: string;
  transactionDate: string;
  transactionDescription: string;
  creditedAmount: number;
  instituteName: string | null;
  sellerId: string | null;
  billIds: string[];
  billNos: string[];
  billAmount: number;
  deductionAmount: number;
  deductionType: string | null;
  deductionReason: string;
  matchedKeyword: string | null;
  confidence: number;
  confidenceLabel: "high" | "low" | "new";
  status: "pending" | "confirmed" | "rejected";
  suggestedType: string | null;
  correctedType: string | null;
  confirmedAt?: string;
  confirmedBy?: string;
}

interface AliasMetaRow {
  keyword: string;
  confidence: number;
  source?: string;
}
interface NegativeKeywordRow {
  keyword: string;
  rejectedCount: number;
}
interface DeductionProfile {
  tdsOnlyCount: number;
  tdsGstCount: number;
  kasarCount: number;
  kasarRange: { min: number | null; max: number | null };
  lastConfirmedType: string | null;
}
interface SellerRecord {
  _id: string;
  instituteName: string;
  statementDescriptionName?: string[];
  aliasMeta?: AliasMetaRow[];
  negativeKeywords?: NegativeKeywordRow[];
  deductionProfile?: DeductionProfile;
  autoApproveTrusted?: boolean;
}

interface OrderLite {
  _id: string;
  orderNo: string;
  firmCode: string;
  instituteName: string;
  totalAmount: number;
  paidAmount?: number;
  isPaid?: boolean;
  status: string;
}

const RETURN_FAMILY = new Set(["CANCELL ORDER", "RETURN ORDER", "RETURN RECEIVED"]);
const DEDUCTION_TYPES = ["TDS", "TDS+GST", "Kasar"];

const formatMoney = (n: number) =>
  (n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const confidencePill = (label: string) => {
  if (label === "high")
    return "bg-emerald-50 border-emerald-200 text-emerald-700";
  if (label === "low") return "bg-amber-50 border-amber-200 text-amber-700";
  return "bg-slate-50 border-slate-200 text-slate-500";
};

type Tab = "pending" | "confirmed" | "rejected";

export default function ReconciliationPage() {
  const [companies, setCompanies] = useState<any[]>([]);
  const [sellers, setSellers] = useState<SellerRecord[]>([]);
  const [orders, setOrders] = useState<OrderLite[]>([]);
  const [firmFilter, setFirmFilter] = useState("");
  const [tab, setTab] = useState<Tab>("pending");
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [currentUsername, setCurrentUsername] = useState("");
  const [patternsFor, setPatternsFor] = useState<string | null>(null);

  const [editState, setEditState] = useState<
    Record<string, { correctedType: string; deductionAmount: string; deductionReason: string }>
  >({});
  const [manualState, setManualState] = useState<
    Record<string, { sellerId: string; billId: string; deductionType: string; deductionAmount: string; deductionReason: string }>
  >({});

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
      .then((data) => setOrders(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load orders", err));

    refreshSellers();
  }, []);

  const refreshSellers = () => {
    fetch("/api/sellers")
      .then((res) => res.json())
      .then((data) => setSellers(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load sellers", err));
  };

  const fetchMatches = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ status: tab });
    if (firmFilter) params.set("firmCode", firmFilter);
    fetch(`/api/reconciliation/matches?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => setMatches(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load matches", err))
      .finally(() => setLoading(false));
  }, [tab, firmFilter]);

  useEffect(() => {
    fetchMatches();
  }, [fetchMatches]);

  const sellerById = useMemo(() => {
    const map: Record<string, SellerRecord> = {};
    sellers.forEach((s) => (map[s._id] = s));
    return map;
  }, [sellers]);

  const openBillsFor = useCallback(
    (instituteName: string | null, firmCode: string) => {
      if (!instituteName) return [];
      return orders.filter(
        (o) =>
          o.instituteName === instituteName &&
          o.firmCode === firmCode &&
          !o.isPaid &&
          !RETURN_FAMILY.has(o.status)
      );
    },
    [orders]
  );

  const getEdit = (m: Match) =>
    editState[m._id] || {
      correctedType: m.suggestedType || "",
      deductionAmount: String(m.deductionAmount || 0),
      deductionReason: m.deductionReason || "",
    };

  const setEdit = (id: string, patch: Partial<{ correctedType: string; deductionAmount: string; deductionReason: string }>) => {
    setEditState((prev) => ({ ...prev, [id]: { ...getEditRaw(prev, id), ...patch } }));
  };
  const getEditRaw = (
    state: Record<string, { correctedType: string; deductionAmount: string; deductionReason: string }>,
    id: string
  ) => state[id] || { correctedType: "", deductionAmount: "0", deductionReason: "" };

  const getManual = (id: string) =>
    manualState[id] || { sellerId: "", billId: "", deductionType: "", deductionAmount: "0", deductionReason: "" };
  const setManual = (id: string, patch: Partial<ReturnType<typeof getManual>>) => {
    setManualState((prev) => ({ ...prev, [id]: { ...getManual(id), ...patch } }));
  };

  const runAction = async (id: string, url: string, body: any) => {
    setBusyId(id);
    try {
      const res = await fetch(url, {
        method: body.method || "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Action failed");
      fetchMatches();
      refreshSellers();
    } catch (err: any) {
      alert(err.message || "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirm = (m: Match) => {
    const edit = getEdit(m);
    if (!m.sellerId || m.billIds.length === 0) {
      alert("Assign an institute and bill before confirming.");
      return;
    }
    runAction(m._id, `/api/reconciliation/matches/${m._id}`, {
      action: "confirm",
      correctedType: edit.correctedType || null,
      deductionAmount: Number(edit.deductionAmount) || 0,
      deductionReason: edit.deductionReason,
      userName: currentUsername,
    });
  };

  const handleReject = (m: Match) => {
    if (!confirm("Reject this suggested match?")) return;
    runAction(m._id, `/api/reconciliation/matches/${m._id}`, { action: "reject", userName: currentUsername });
  };

  const handleReverse = (m: Match) => {
    if (!confirm("Reverse this confirmed match? The bill's payment status will be rolled back.")) return;
    runAction(m._id, `/api/reconciliation/matches/${m._id}`, { action: "reverse", userName: currentUsername });
  };

  const handleSaveManual = async (m: Match) => {
    const man = getManual(m._id);
    if (!man.sellerId) {
      alert("Select an institute first.");
      return;
    }
    setBusyId(m._id);
    try {
      const res = await fetch("/api/reconciliation/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchId: m._id,
          sellerId: man.sellerId,
          billId: man.billId || undefined,
          deductionType: man.deductionType || undefined,
          deductionAmount: man.deductionAmount ? Number(man.deductionAmount) : undefined,
          deductionReason: man.deductionReason,
          userName: currentUsername,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to save");
      fetchMatches();
      refreshSellers();
    } catch (err: any) {
      alert(err.message || "Failed to save");
    } finally {
      setBusyId(null);
    }
  };

  const toggleAutoApprove = async (seller: SellerRecord) => {
    try {
      await fetch("/api/sellers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _id: seller._id, autoApproveTrusted: !seller.autoApproveTrusted }),
      });
      refreshSellers();
    } catch (err) {
      console.error(err);
    }
  };

  const pendingResolved = matches.filter((m) => m.status === "pending" && m.sellerId && m.billIds.length > 0);
  const pendingUnresolved = matches.filter((m) => m.status === "pending" && (!m.sellerId || m.billIds.length === 0));

  const patternsSeller = patternsFor ? sellerById[patternsFor] : null;

  return (
    <BlockGuard
      permission="bankReconciliation"
      fallback={
        <div className="flex flex-col items-center gap-2 m-4 p-4 border border-red-200 rounded-xl bg-red-50 text-center">
          <p className="text-red-500 font-bold uppercase">You have no Access for this Page.</p>
          <Link
            href="/dashboard"
            className="text-sm bg-slate-900 text-white px-4 py-2 mt-4 rounded-lg hover:bg-slate-800 transition-all"
          >
            Go to Dashboard
          </Link>
        </div>
      }
    >
      <div className="p-4 md:p-8 bg-slate-50 min-h-screen">
        <div className="max-w-7xl mx-auto flex flex-col gap-6">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Link href="/dashboard/account" className="flex items-center gap-2 text-slate-500 hover:text-blue-600 text-xs mb-2 transition-colors w-fit">
                <FiArrowLeft /> Back to Account
              </Link>
              <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
                <FiCheckSquare className="text-blue-600" /> Bank Reconciliation
              </h1>
              <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mt-0.5">
                Review & Confirm Auto-Matched Payments
              </p>
            </div>
            <button
              onClick={fetchMatches}
              className="flex items-center gap-1.5 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl py-2 px-3 text-[11px] font-bold text-slate-600 transition-colors"
            >
              <FiRefreshCw size={12} /> Refresh
            </button>
          </div>

          {/* Filters + Tabs */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl p-1">
              {(["pending", "confirmed", "rejected"] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wide transition-colors ${
                    tab === t ? "bg-blue-600 text-white shadow" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {t === "pending" ? "Pending Review" : t}
                </button>
              ))}
            </div>
            <select
              value={firmFilter}
              onChange={(e) => setFirmFilter(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs text-slate-700 focus:outline-none focus:border-blue-500 font-bold"
            >
              <option value="">All Firms</option>
              {companies.map((c) => (
                <option key={c._id} value={c.firmCode}>
                  {c.firmName} {c.firmCode ? `(${c.firmCode})` : ""}
                </option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="flex justify-center items-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-blue-500"></div>
            </div>
          ) : tab === "pending" ? (
            <>
              {/* Pending Review table */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                    <FiCheckCircle className="text-blue-600" size={14} /> Pending Review
                    <span className="bg-slate-100 text-slate-600 text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none">
                      {pendingResolved.length}
                    </span>
                  </h3>
                </div>
                {pendingResolved.length === 0 ? (
                  <div className="text-center py-10 text-slate-400 text-xs font-bold uppercase tracking-widest">
                    Nothing to review
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                          <th className="py-2.5 px-3">Bill No</th>
                          <th className="py-2.5 px-3">Institute</th>
                          <th className="py-2.5 px-3 text-right">Bill Amt</th>
                          <th className="py-2.5 px-3 text-right">Credited Amt</th>
                          <th className="py-2.5 px-3 text-right">Deduction</th>
                          <th className="py-2.5 px-3">Type</th>
                          <th className="py-2.5 px-3">Confidence</th>
                          <th className="py-2.5 px-3 text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {pendingResolved.map((m) => {
                          const edit = getEdit(m);
                          const isKasar = edit.correctedType === "Kasar";
                          return (
                            <tr key={m._id} className="hover:bg-blue-50/40 transition-colors align-top">
                              <td className="py-2.5 px-3 font-mono text-slate-700">
                                {m.billNos.join(", ") || "—"}
                                {m.billIds.length > 1 && (
                                  <span className="block text-[9px] text-purple-600 font-bold uppercase">combo match</span>
                                )}
                              </td>
                              <td className="py-2.5 px-3">
                                <button
                                  onClick={() => setPatternsFor(m.sellerId)}
                                  className="text-blue-700 font-bold hover:underline text-left"
                                >
                                  {m.instituteName}
                                </button>
                                <div className="text-[9px] text-slate-400 truncate max-w-[180px]" title={m.transactionDescription}>
                                  {m.transactionDescription}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono">₹{formatMoney(m.billAmount)}</td>
                              <td className="py-2.5 px-3 text-right font-mono text-emerald-700">₹{formatMoney(m.creditedAmount)}</td>
                              <td className="py-2.5 px-3 text-right">
                                <input
                                  type="number"
                                  value={edit.deductionAmount}
                                  onChange={(e) => setEdit(m._id, { deductionAmount: e.target.value })}
                                  className="w-24 bg-slate-50 border border-slate-200 rounded-lg py-1 px-2 text-right font-mono text-xs focus:outline-none focus:border-blue-500"
                                />
                              </td>
                              <td className="py-2.5 px-3">
                                <select
                                  value={edit.correctedType}
                                  onChange={(e) => setEdit(m._id, { correctedType: e.target.value })}
                                  className="bg-slate-50 border border-slate-200 rounded-lg py-1 px-2 text-xs font-bold focus:outline-none focus:border-blue-500"
                                >
                                  <option value="">None</option>
                                  {DEDUCTION_TYPES.map((t) => (
                                    <option key={t} value={t}>{t}</option>
                                  ))}
                                </select>
                                {isKasar && (
                                  <input
                                    type="text"
                                    placeholder="Reason..."
                                    value={edit.deductionReason}
                                    onChange={(e) => setEdit(m._id, { deductionReason: e.target.value })}
                                    className="mt-1 w-32 bg-slate-50 border border-slate-200 rounded-lg py-1 px-2 text-[10px] focus:outline-none focus:border-blue-500"
                                  />
                                )}
                              </td>
                              <td className="py-2.5 px-3">
                                <span className={`inline-block border text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${confidencePill(m.confidenceLabel)}`}>
                                  {m.confidenceLabel}
                                </span>
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="flex items-center justify-center gap-1.5">
                                  <button
                                    disabled={busyId === m._id}
                                    onClick={() => handleConfirm(m)}
                                    className="p-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition-colors disabled:opacity-40"
                                    title="Confirm"
                                  >
                                    <FiCheckCircle size={13} />
                                  </button>
                                  <button
                                    disabled={busyId === m._id}
                                    onClick={() => handleReject(m)}
                                    className="p-2 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition-colors disabled:opacity-40"
                                    title="Reject"
                                  >
                                    <FiXCircle size={13} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Unmatched Transactions */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                    <FiAlertTriangle className="text-amber-500" size={14} /> Unmatched Transactions
                    <span className="bg-slate-100 text-slate-600 text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none">
                      {pendingUnresolved.length}
                    </span>
                  </h3>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Assign an institute + bill manually — the description&apos;s keyword is learned as a new alias for next time.
                  </p>
                </div>
                {pendingUnresolved.length === 0 ? (
                  <div className="text-center py-10 text-slate-400 text-xs font-bold uppercase tracking-widest">
                    Nothing unmatched
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">Description</th>
                          <th className="py-2.5 px-3 text-right">Credited</th>
                          <th className="py-2.5 px-3">Institute</th>
                          <th className="py-2.5 px-3">Bill</th>
                          <th className="py-2.5 px-3">Deduction</th>
                          <th className="py-2.5 px-3 text-center">Save</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {pendingUnresolved.map((m) => {
                          const man = getManual(m._id);
                          const bills = openBillsFor(sellerById[man.sellerId]?.instituteName || null, m.firmCode);
                          return (
                            <tr key={m._id} className="hover:bg-amber-50/30 transition-colors align-top">
                              <td className="py-2.5 px-3 font-mono text-slate-600">{m.transactionDate}</td>
                              <td className="py-2.5 px-3 text-slate-700 max-w-[220px] truncate" title={m.transactionDescription}>
                                {m.transactionDescription}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-emerald-700">₹{formatMoney(m.creditedAmount)}</td>
                              <td className="py-2.5 px-3">
                                <select
                                  value={man.sellerId}
                                  onChange={(e) => setManual(m._id, { sellerId: e.target.value, billId: "" })}
                                  className="bg-slate-50 border border-slate-200 rounded-lg py-1 px-2 text-xs font-bold focus:outline-none focus:border-blue-500 max-w-[160px]"
                                >
                                  <option value="">Select Institute...</option>
                                  {sellers.map((s) => (
                                    <option key={s._id} value={s._id}>{s.instituteName}</option>
                                  ))}
                                </select>
                              </td>
                              <td className="py-2.5 px-3">
                                <select
                                  value={man.billId}
                                  onChange={(e) => setManual(m._id, { billId: e.target.value })}
                                  disabled={!man.sellerId}
                                  className="bg-slate-50 border border-slate-200 rounded-lg py-1 px-2 text-xs font-bold focus:outline-none focus:border-blue-500 max-w-[160px] disabled:opacity-40"
                                >
                                  <option value="">No bill (link only)</option>
                                  {bills.map((b) => (
                                    <option key={b._id} value={b._id}>
                                      {b.orderNo} — ₹{formatMoney(b.totalAmount - (b.paidAmount || 0))}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="flex flex-col gap-1">
                                  <select
                                    value={man.deductionType}
                                    onChange={(e) => setManual(m._id, { deductionType: e.target.value })}
                                    className="bg-slate-50 border border-slate-200 rounded-lg py-1 px-2 text-xs font-bold focus:outline-none focus:border-blue-500"
                                  >
                                    <option value="">None</option>
                                    {DEDUCTION_TYPES.map((t) => (
                                      <option key={t} value={t}>{t}</option>
                                    ))}
                                  </select>
                                  <input
                                    type="number"
                                    placeholder="Amt"
                                    value={man.deductionAmount}
                                    onChange={(e) => setManual(m._id, { deductionAmount: e.target.value })}
                                    className="w-24 bg-slate-50 border border-slate-200 rounded-lg py-1 px-2 text-xs font-mono focus:outline-none focus:border-blue-500"
                                  />
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                <button
                                  disabled={busyId === m._id || !man.sellerId}
                                  onClick={() => handleSaveManual(m)}
                                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-black uppercase text-[10px] tracking-wide py-2 px-3 rounded-lg transition-colors"
                                >
                                  Save & Learn
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 capitalize">
                  {tab} Matches
                  <span className="ml-2 bg-slate-100 text-slate-600 text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none">
                    {matches.length}
                  </span>
                </h3>
              </div>
              {matches.length === 0 ? (
                <div className="text-center py-10 text-slate-400 text-xs font-bold uppercase tracking-widest">No records</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                        <th className="py-2.5 px-3">Date</th>
                        <th className="py-2.5 px-3">Bill No</th>
                        <th className="py-2.5 px-3">Institute</th>
                        <th className="py-2.5 px-3 text-right">Credited</th>
                        <th className="py-2.5 px-3 text-right">Deduction</th>
                        <th className="py-2.5 px-3">Type</th>
                        {tab === "confirmed" && <th className="py-2.5 px-3 text-center">Actions</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {matches.map((m) => (
                        <tr key={m._id} className="hover:bg-slate-50 transition-colors">
                          <td className="py-2.5 px-3 font-mono text-slate-600">{m.transactionDate}</td>
                          <td className="py-2.5 px-3 font-mono text-slate-700">{m.billNos.join(", ") || "—"}</td>
                          <td className="py-2.5 px-3 text-slate-700">{m.instituteName || "—"}</td>
                          <td className="py-2.5 px-3 text-right font-mono text-emerald-700">₹{formatMoney(m.creditedAmount)}</td>
                          <td className="py-2.5 px-3 text-right font-mono text-red-600">
                            {m.deductionAmount ? `₹${formatMoney(m.deductionAmount)}` : "—"}
                          </td>
                          <td className="py-2.5 px-3">{m.correctedType || m.deductionType || "—"}</td>
                          {tab === "confirmed" && (
                            <td className="py-2.5 px-3 text-center">
                              <button
                                disabled={busyId === m._id}
                                onClick={() => handleReverse(m)}
                                className="inline-flex items-center gap-1 p-2 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 transition-colors disabled:opacity-40"
                                title="Reverse"
                              >
                                <FiRotateCcw size={13} />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Learned Patterns drawer */}
      {patternsSeller && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-hidden shadow-2xl flex flex-col">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                  <FiInfo className="text-blue-600" /> Learned Patterns
                </h3>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">{patternsSeller.instituteName}</p>
              </div>
              <button onClick={() => setPatternsFor(null)} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                <FiX size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Keyword Aliases</span>
                  <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!patternsSeller.autoApproveTrusted}
                      onChange={() => toggleAutoApprove(patternsSeller)}
                    />
                    Auto-approve trusted matches
                  </label>
                </div>
                <div className="space-y-1.5">
                  {(patternsSeller.statementDescriptionName || []).length === 0 && (
                    <p className="text-[11px] text-slate-400">No aliases learned yet.</p>
                  )}
                  {(patternsSeller.statementDescriptionName || []).map((kw) => {
                    const meta = (patternsSeller.aliasMeta || []).find(
                      (a) => a.keyword.trim().toLowerCase() === kw.trim().toLowerCase()
                    );
                    return (
                      <div key={kw} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
                        <span className="text-[11px] font-bold text-slate-700">{kw}</span>
                        <span className="flex items-center gap-1.5">
                          <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full border ${confidencePill(meta && meta.confidence >= 3 ? "high" : meta ? "low" : "new")}`}>
                            conf {meta?.confidence ?? 1}
                          </span>
                          <span className="text-[9px] text-slate-400 uppercase">{meta?.source || "manual_seed"}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {(patternsSeller.negativeKeywords || []).length > 0 && (
                <div>
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider block mb-2">Rejected Keywords</span>
                  <div className="space-y-1.5">
                    {(patternsSeller.negativeKeywords || []).map((n) => (
                      <div key={n.keyword} className="flex items-center justify-between bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
                        <span className="text-[11px] font-bold text-red-700">{n.keyword}</span>
                        <span className="text-[9px] text-red-500 font-black">×{n.rejectedCount}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider block mb-2">Deduction History</span>
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-center">
                    <span className="text-[9px] font-black uppercase text-slate-400 block">TDS</span>
                    <span className="text-sm font-black text-slate-800">{patternsSeller.deductionProfile?.tdsOnlyCount || 0}</span>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-center">
                    <span className="text-[9px] font-black uppercase text-slate-400 block">TDS+GST</span>
                    <span className="text-sm font-black text-slate-800">{patternsSeller.deductionProfile?.tdsGstCount || 0}</span>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-center">
                    <span className="text-[9px] font-black uppercase text-slate-400 block">Kasar</span>
                    <span className="text-sm font-black text-slate-800">{patternsSeller.deductionProfile?.kasarCount || 0}</span>
                  </div>
                </div>
                {patternsSeller.deductionProfile?.kasarRange?.min !== null &&
                  patternsSeller.deductionProfile?.kasarRange?.min !== undefined && (
                    <p className="text-[10px] text-slate-500 mt-2">
                      Typical Kasar range: {patternsSeller.deductionProfile.kasarRange.min?.toFixed(2)}% – {patternsSeller.deductionProfile.kasarRange.max?.toFixed(2)}%
                    </p>
                  )}
              </div>
            </div>
          </div>
        </div>
      )}
    </BlockGuard>
  );
}
