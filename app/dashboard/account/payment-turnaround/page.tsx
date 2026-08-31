"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { FiArrowLeft, FiClock, FiAward, FiAlertTriangle, FiList, FiFilter } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";

interface InstituteRow {
  instituteName: string;
  totalBills: number;
  paidBills: number;
  pendingBills: number;
  totalPaidAmount: number;
  totalPendingAmount: number;
  avgDaysBillToPayment: number | null;
  avgDaysDeliveryToPayment: number | null;
  minDays: number | null;
  maxDays: number | null;
  speedScore: number;
  consistencyScore: number;
  pendingRatioScore: number;
  reliabilityScore: number;
  reliabilityBand: "Excellent" | "Good" | "Average" | "Poor";
}
interface DetailRow {
  orderId: string;
  billNumber: string;
  billSource: "bill" | "order";
  firmCode: string;
  instituteName: string;
  billDate: string;
  deliveryDate: string | null;
  paymentDate: string | null;
  daysBillToPayment: number | null;
  daysDeliveryToPayment: number | null;
  amount: number;
  status: "Paid" | "Pending";
}
interface AgeingBucket {
  bucket: "0-30" | "31-60" | "61-90" | "90+";
  count: number;
  amount: number;
  byInstitute: { instituteName: string; count: number; amount: number }[];
}

const fmtMoney = (n: number) => (n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-IN") : "—");

const BAND_COLOR: Record<string, string> = {
  Excellent: "bg-emerald-100 text-emerald-800 border-emerald-300",
  Good: "bg-blue-100 text-blue-800 border-blue-300",
  Average: "bg-amber-100 text-amber-800 border-amber-300",
  Poor: "bg-red-100 text-red-800 border-red-300",
};
const BUCKET_COLOR: Record<string, string> = {
  "0-30": "border-slate-200",
  "31-60": "border-amber-300",
  "61-90": "border-orange-400",
  "90+": "border-red-400 bg-red-50",
};

type Tab = "ranking" | "ageing" | "detail";

export default function PaymentTurnaroundPage() {
  const [tab, setTab] = useState<Tab>("ranking");
  const [companies, setCompanies] = useState<any[]>([]);
  const [firmFilter, setFirmFilter] = useState("");
  const [instituteFilter, setInstituteFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const [institutes, setInstitutes] = useState<InstituteRow[]>([]);
  const [rankBy, setRankBy] = useState<"score" | "speed">("score");
  const [loadingInstitutes, setLoadingInstitutes] = useState(false);

  const [ageing, setAgeing] = useState<{ ageFrom: string; buckets: AgeingBucket[] } | null>(null);
  const [ageFrom, setAgeFrom] = useState<"deliveryDate" | "billDate">("deliveryDate");
  const [loadingAgeing, setLoadingAgeing] = useState(false);

  const [rows, setRows] = useState<DetailRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [sortBy, setSortBy] = useState<"daysDelivery" | "daysBill">("daysDelivery");

  useEffect(() => {
    fetch("/api/companies").then((r) => r.json()).then((d) => setCompanies(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const loadInstitutes = useCallback(() => {
    setLoadingInstitutes(true);
    const params = new URLSearchParams();
    if (firmFilter) params.set("firmCode", firmFilter);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    fetch(`/api/reports/payment-turnaround/reliability-score?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => setInstitutes(Array.isArray(d.institutes) ? d.institutes : []))
      .finally(() => setLoadingInstitutes(false));
  }, [firmFilter, from, to]);

  const loadAgeing = useCallback(() => {
    setLoadingAgeing(true);
    const params = new URLSearchParams({ ageFrom });
    if (firmFilter) params.set("firmCode", firmFilter);
    fetch(`/api/reports/payment-turnaround/ageing?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => setAgeing(d))
      .finally(() => setLoadingAgeing(false));
  }, [firmFilter, ageFrom]);

  const loadRows = useCallback(() => {
    setLoadingRows(true);
    const params = new URLSearchParams();
    if (firmFilter) params.set("firmCode", firmFilter);
    if (instituteFilter) params.set("instituteName", instituteFilter);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (statusFilter) params.set("status", statusFilter);
    fetch(`/api/reports/payment-turnaround?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d.rows) ? d.rows : []))
      .finally(() => setLoadingRows(false));
  }, [firmFilter, instituteFilter, from, to, statusFilter]);

  useEffect(() => {
    if (tab === "ranking") loadInstitutes();
    else if (tab === "ageing") loadAgeing();
    else loadRows();
  }, [tab, loadInstitutes, loadAgeing, loadRows]);

  const rankedInstitutes = useMemo(() => {
    const copy = [...institutes];
    if (rankBy === "score") copy.sort((a, b) => b.reliabilityScore - a.reliabilityScore);
    else
      copy.sort((a, b) => {
        if (a.avgDaysDeliveryToPayment === null && b.avgDaysDeliveryToPayment === null) return 0;
        if (a.avgDaysDeliveryToPayment === null) return 1;
        if (b.avgDaysDeliveryToPayment === null) return -1;
        return a.avgDaysDeliveryToPayment - b.avgDaysDeliveryToPayment;
      });
    return copy;
  }, [institutes, rankBy]);

  const sortedRows = useMemo(() => {
    const key = sortBy === "daysDelivery" ? "daysDeliveryToPayment" : "daysBillToPayment";
    return [...rows].sort((a: any, b: any) => {
      if (a[key] === null && b[key] === null) return 0;
      if (a[key] === null) return 1;
      if (b[key] === null) return -1;
      return b[key] - a[key];
    });
  }, [rows, sortBy]);

  return (
    <BlockGuard permission="accountStatements">
      <div className="p-4 md:p-8 bg-slate-50 min-h-screen">
        <div className="max-w-7xl mx-auto flex flex-col gap-6">
          <div>
            <Link href="/dashboard/account" className="flex items-center gap-2 text-slate-500 hover:text-blue-600 text-xs mb-2 transition-colors w-fit">
              <FiArrowLeft /> Back to Account
            </Link>
            <h1 className="text-xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
              <FiClock className="text-cyan-700" /> Payment Turnaround Report
            </h1>
            <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mt-0.5">
              How long institutes take to pay after delivery
            </p>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1.5 bg-slate-100 rounded-xl p-1 w-fit">
            <TabButton active={tab === "ranking"} onClick={() => setTab("ranking")} icon={<FiAward size={12} />} label="Institute Ranking" />
            <TabButton active={tab === "ageing"} onClick={() => setTab("ageing")} icon={<FiAlertTriangle size={12} />} label="Ageing (Pending)" />
            <TabButton active={tab === "detail"} onClick={() => setTab("detail")} icon={<FiList size={12} />} label="Per-Bill Detail" />
          </div>

          {/* Filters */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex flex-wrap items-center gap-2">
            <FiFilter className="text-slate-400" size={14} />
            <select value={firmFilter} onChange={(e) => setFirmFilter(e.target.value)} className={filterCls}>
              <option value="">All Firms</option>
              {companies.map((c) => (
                <option key={c._id} value={c.firmCode}>{c.firmName} ({c.firmCode})</option>
              ))}
            </select>
            {tab === "detail" && (
              <>
                <input
                  value={instituteFilter}
                  onChange={(e) => setInstituteFilter(e.target.value)}
                  placeholder="Institute name..."
                  className={filterCls}
                />
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={filterCls}>
                  <option value="All">All Status</option>
                  <option value="Paid">Paid</option>
                  <option value="Pending">Pending</option>
                </select>
              </>
            )}
            {(tab === "ranking" || tab === "detail") && (
              <>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={filterCls} />
                <span className="text-slate-400 text-xs">to</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={filterCls} />
              </>
            )}
            {tab === "ageing" && (
              <select value={ageFrom} onChange={(e) => setAgeFrom(e.target.value as any)} className={filterCls}>
                <option value="deliveryDate">Age from Delivery Date</option>
                <option value="billDate">Age from Bill Date</option>
              </select>
            )}
          </div>

          {/* ===== Ranking tab ===== */}
          {tab === "ranking" && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-900">{institutes.length} Institutes</h3>
                <div className="flex items-center gap-1.5 bg-slate-100 rounded-lg p-1">
                  <button onClick={() => setRankBy("score")} className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase ${rankBy === "score" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}>
                    By Score
                  </button>
                  <button onClick={() => setRankBy("speed")} className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase ${rankBy === "speed" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}>
                    By Speed
                  </button>
                </div>
              </div>
              {loadingInstitutes ? (
                <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-5 w-5 border-t-2 border-blue-500"></div></div>
              ) : rankedInstitutes.length === 0 ? (
                <p className="text-xs text-slate-400 uppercase font-bold tracking-widest text-center py-10">No paid/pending bill data yet</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                        <th className="py-2.5 px-3">#</th>
                        <th className="py-2.5 px-3">Institute</th>
                        <th className="py-2.5 px-3 text-right">Avg Days (Delivery→Pay)</th>
                        <th className="py-2.5 px-3 text-right">Min / Max</th>
                        <th className="py-2.5 px-3 text-right">Paid / Pending Bills</th>
                        <th className="py-2.5 px-3 text-right">Pending Amount</th>
                        <th className="py-2.5 px-3 text-center">Reliability Score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rankedInstitutes.map((inst, idx) => (
                        <tr key={inst.instituteName} className="hover:bg-blue-50/40 transition-colors">
                          <td className="py-2.5 px-3 text-slate-400 font-bold">{idx + 1}</td>
                          <td className="py-2.5 px-3 font-black text-slate-800">{inst.instituteName}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-700">
                            {inst.avgDaysDeliveryToPayment ?? "—"}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                            {inst.minDays ?? "—"} / {inst.maxDays ?? "—"}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-600">{inst.paidBills} / {inst.pendingBills}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-red-600">₹{fmtMoney(inst.totalPendingAmount)}</td>
                          <td className="py-2.5 px-3 text-center">
                            <span className={`inline-block border text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${BAND_COLOR[inst.reliabilityBand]}`}>
                              {inst.reliabilityScore} · {inst.reliabilityBand}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ===== Ageing tab ===== */}
          {tab === "ageing" && (
            <div className="flex flex-col gap-4">
              {loadingAgeing ? (
                <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-5 w-5 border-t-2 border-blue-500"></div></div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {(ageing?.buckets || []).map((b) => (
                    <div key={b.bucket} className={`bg-white border-2 rounded-2xl shadow-sm p-4 ${BUCKET_COLOR[b.bucket]}`}>
                      <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${b.bucket === "90+" ? "text-red-700" : "text-slate-500"}`}>
                        {b.bucket} days
                      </p>
                      <p className={`text-xl font-black ${b.bucket === "90+" ? "text-red-700" : "text-slate-800"}`}>₹{fmtMoney(b.amount)}</p>
                      <p className="text-[10px] font-bold text-slate-400 mb-3">{b.count} bills pending</p>
                      <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                        {b.byInstitute.slice(0, 8).map((i) => (
                          <div key={i.instituteName} className="flex items-center justify-between text-[10px]">
                            <span className="font-bold text-slate-600 truncate pr-2">{i.instituteName}</span>
                            <span className="font-mono text-slate-500 shrink-0">₹{fmtMoney(i.amount)}</span>
                          </div>
                        ))}
                        {b.byInstitute.length > 8 && (
                          <p className="text-[9px] text-slate-400 font-bold">+{b.byInstitute.length - 8} more</p>
                        )}
                        {b.byInstitute.length === 0 && <p className="text-[10px] text-slate-300 font-bold">None</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ===== Detail tab ===== */}
          {tab === "detail" && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-900">{rows.length} Bills</h3>
                <div className="flex items-center gap-1.5 bg-slate-100 rounded-lg p-1">
                  <button onClick={() => setSortBy("daysDelivery")} className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase ${sortBy === "daysDelivery" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}>
                    Sort: Delivery→Pay
                  </button>
                  <button onClick={() => setSortBy("daysBill")} className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase ${sortBy === "daysBill" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}>
                    Sort: Bill→Pay
                  </button>
                </div>
              </div>
              {loadingRows ? (
                <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-5 w-5 border-t-2 border-blue-500"></div></div>
              ) : sortedRows.length === 0 ? (
                <p className="text-xs text-slate-400 uppercase font-bold tracking-widest text-center py-10">No bills found</p>
              ) : (
                <div className="overflow-x-auto max-h-[70vh]">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="sticky top-0 bg-slate-50 z-10">
                      <tr className="text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                        <th className="py-2.5 px-3">Institute</th>
                        <th className="py-2.5 px-3">Firm</th>
                        <th className="py-2.5 px-3">Bill No.</th>
                        <th className="py-2.5 px-3">Bill Date</th>
                        <th className="py-2.5 px-3">Delivery Date</th>
                        <th className="py-2.5 px-3">Payment Date</th>
                        <th className="py-2.5 px-3 text-right">Days Bill→Pay</th>
                        <th className="py-2.5 px-3 text-right">Days Delivery→Pay</th>
                        <th className="py-2.5 px-3 text-right">Amount</th>
                        <th className="py-2.5 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {sortedRows.map((r) => (
                        <tr key={r.orderId} className="hover:bg-blue-50/40 transition-colors">
                          <td className="py-2 px-3 font-bold text-slate-700">{r.instituteName}</td>
                          <td className="py-2 px-3 text-slate-500">{r.firmCode}</td>
                          <td className="py-2 px-3 text-slate-600">{r.billNumber}</td>
                          <td className="py-2 px-3 text-slate-500">{fmtDate(r.billDate)}</td>
                          <td className="py-2 px-3 text-slate-500">{fmtDate(r.deliveryDate)}</td>
                          <td className="py-2 px-3 text-slate-500">{fmtDate(r.paymentDate)}</td>
                          <td className="py-2 px-3 text-right font-mono text-slate-700">{r.daysBillToPayment ?? "—"}</td>
                          <td className="py-2 px-3 text-right font-mono text-slate-700">{r.daysDeliveryToPayment ?? "—"}</td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-slate-800">₹{fmtMoney(r.amount)}</td>
                          <td className="py-2 px-3">
                            <span className={`inline-block border text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${r.status === "Paid" ? "bg-emerald-50 text-emerald-700 border-emerald-300" : "bg-slate-100 text-slate-600 border-slate-300"}`}>
                              {r.status}
                            </span>
                          </td>
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
    </BlockGuard>
  );
}

const filterCls = "bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-[11px] font-bold text-slate-700 focus:outline-none focus:border-blue-500";

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wide transition-colors ${
        active ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
      }`}
    >
      {icon} {label}
    </button>
  );
}
