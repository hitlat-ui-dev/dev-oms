"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  FiArrowLeft,
  FiBarChart2,
  FiRefreshCw,
  FiTrendingUp,
  FiClock,
  FiCheckCircle,
  FiDollarSign,
  FiAlertCircle,
  FiUsers,
  FiTruck,
  FiPackage,
  FiFileText,
} from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";

interface StatusRow {
  status: string;
  count: number;
  value: number;
}

interface TeamActivityRow {
  username: string;
  totalActions: number;
  actions: Record<string, number>;
  ordersCreated: number;
  ordersCreatedQty: number;
  filesUploaded: number;
  productsCompleted: number;
}

interface DailyBucket {
  bucket: string; // "YYYY-MM-DD" (day) or "YYYY-MM" (month)
  totalActions: number;
  actions: Record<string, number>;
  ordersCreated: number;
  ordersCreatedQty: number;
  filesUploaded: number;
  productsCompleted: number;
}

interface SummaryData {
  totals: {
    totalOrderValue: number;
    orderCount: number;
    totalReceived: number;
    totalDeducted: number;
    pendingPaymentValue: number;
  };
  today: {
    todayOrderValue: number;
    todayOrderCount: number;
  };
  thisMonth: {
    monthOrderValue: number;
    monthOrderCount: number;
  };
  pending: {
    pendingOrderCount: number;
    pendingOrderValue: number;
  };
  statusBreakdown: StatusRow[];
  purchase: {
    todayPurchaseValue: number;
    todayPurchaseCount: number;
    openPurchaseRequests: number;
  };
  teamActivity: TeamActivityRow[];
  billsToday: {
    totalCount: number;
    totalValue: number;
    byFirm: { firmCode: string; count: number; value: number }[];
  };
  pendingBillsByFirm: { firmCode: string; count: number; value: number }[];
  billsByUser: { username: string; count: number; value: number }[];
  billsByUserToday: { username: string; count: number; value: number }[];
  gemSync?: {
    actions: { okLink: number; updateStock: number; newLink: number };
    checklist: {
      stockUpdate: { pending: number; synced: number };
      newUploadLink: { pending: number; synced: number };
    };
    byUser: { username: string; okLink: number; updateStock: number; newLink: number; total: number }[];
  };
}

const formatMoney = (n: number) =>
  (n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatInt = (n: number) => (n || 0).toLocaleString("en-IN");

const STATUS_COLORS: Record<string, string> = {
  "TO CHECK": "bg-amber-500",
  "READY TO SHIP": "bg-blue-500",
  DELIVERY: "bg-indigo-500",
  FULFILLED: "bg-emerald-500",
  HISAB: "bg-purple-500",
  "CANCELL ORDER": "bg-slate-400",
  "RETURN ORDER": "bg-red-400",
  "RETURN RECEIVED": "bg-red-500",
};

function StatCard({
  icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex items-start gap-3">
      <div className={`${color} text-white p-2.5 rounded-xl shrink-0`}>{icon}</div>
      <div className="min-w-0">
        <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block truncate">{label}</span>
        <span className="text-base sm:text-lg font-black text-slate-800 block leading-tight mt-0.5 truncate" title={value}>{value}</span>
        {sub && <span className="text-[10px] text-slate-400 font-bold block mt-0.5 truncate">{sub}</span>}
      </div>
    </div>
  );
}

export default function SummaryDashboardPage() {
  const [companies, setCompanies] = useState<any[]>([]);
  const [firmFilter, setFirmFilter] = useState("");
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(false);

  const [perfRange, setPerfRange] = useState<"month" | "year">("month");
  const [perfData, setPerfData] = useState<TeamActivityRow[] | null>(null);
  const [perfLoading, setPerfLoading] = useState(false);
  const [selectedMember, setSelectedMember] = useState("");
  const [dailySeries, setDailySeries] = useState<DailyBucket[] | null>(null);
  const [dailyBucketBy, setDailyBucketBy] = useState<"day" | "month">("day");
  const [dailyLoading, setDailyLoading] = useState(false);

  useEffect(() => {
    fetch("/api/companies")
      .then((res) => res.json())
      .then((d) => setCompanies(Array.isArray(d) ? d : []))
      .catch((err) => console.error("Failed to load firms", err));
  }, []);

  const fetchSummary = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (firmFilter) params.set("firmCode", firmFilter);
    fetch(`/api/dashboard-summary?${params.toString()}`)
      .then((res) => res.json())
      .then((d) => setData(d))
      .catch((err) => console.error("Failed to load summary", err))
      .finally(() => setLoading(false));
  }, [firmFilter]);

  const fetchTeamPerformance = useCallback((range: "month" | "year") => {
    setPerfLoading(true);
    const params = new URLSearchParams({ range });
    if (firmFilter) params.set("firmCode", firmFilter);
    fetch(`/api/team-performance?${params.toString()}`)
      .then((res) => res.json())
      .then((d) => setPerfData(Array.isArray(d.teamActivity) ? d.teamActivity : []))
      .catch((err) => console.error("Failed to load team performance", err))
      .finally(() => setPerfLoading(false));
  }, [firmFilter]);

  // Loads (or reloads) Team Performance right after the main "Scan Data" -
  // gated the same way the rest of this page is (nothing runs until the
  // user explicitly presses Scan Data), and again whenever the Month/Year
  // toggle or firm filter changes afterwards.
  useEffect(() => {
    if (data) fetchTeamPerformance(perfRange);
  }, [data, perfRange, fetchTeamPerformance]);

  // Keeps the selected team member valid as perfData reloads (range/firm
  // change) - defaults to the top scorer, but keeps whoever's already
  // selected if they're still present in the new list.
  useEffect(() => {
    if (!perfData || perfData.length === 0) {
      setSelectedMember("");
      return;
    }
    setSelectedMember((prev) => (prev && perfData.some((r) => r.username === prev) ? prev : perfData[0].username));
  }, [perfData]);

  const fetchDailyPerformance = useCallback((username: string, range: "month" | "year") => {
    setDailyLoading(true);
    const params = new URLSearchParams({ username, range });
    if (firmFilter) params.set("firmCode", firmFilter);
    fetch(`/api/team-performance/daily?${params.toString()}`)
      .then((res) => res.json())
      .then((d) => {
        setDailySeries(Array.isArray(d.series) ? d.series : []);
        setDailyBucketBy(d.bucketBy === "month" ? "month" : "day");
      })
      .catch((err) => console.error("Failed to load daily team performance", err))
      .finally(() => setDailyLoading(false));
  }, [firmFilter]);

  useEffect(() => {
    if (selectedMember) fetchDailyPerformance(selectedMember, perfRange);
  }, [selectedMember, perfRange, fetchDailyPerformance]);

  // No auto-run on mount - this aggregates across sellerorders/items/gem_sheets
  // in full, so it only scans when the button below is explicitly pressed.
  const maxStatusValue = useMemo(
    () => Math.max(1, ...(data?.statusBreakdown || []).map((s) => s.value)),
    [data]
  );

  const dayScore = (r: DailyBucket) => r.totalActions + r.ordersCreated + r.filesUploaded + r.productsCompleted;
  const maxDailyValue = useMemo(() => Math.max(1, ...(dailySeries || []).map(dayScore)), [dailySeries]);

  const formatBucketLabel = (bucket: string, bucketBy: "day" | "month") => {
    if (bucketBy === "day") return String(Number(bucket.split("-")[2]));
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return monthNames[Number(bucket.split("-")[1]) - 1] || bucket;
  };

  return (
    <BlockGuard
      permission="dashboardSummary"
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
              <Link href="/dashboard" className="flex items-center gap-2 text-slate-500 hover:text-blue-600 text-xs mb-2 transition-colors w-fit">
                <FiArrowLeft /> Back to Dashboard
              </Link>
              <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
                <FiBarChart2 className="text-blue-600" /> Summary Dashboard
              </h1>
              <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mt-0.5">
                Whole-System Business Overview
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <select
                value={firmFilter}
                onChange={(e) => setFirmFilter(e.target.value)}
                className="bg-white border border-slate-200 rounded-xl py-2 px-3 text-xs text-slate-700 focus:outline-none focus:border-blue-500 font-bold min-w-0 max-w-[45vw] sm:max-w-[220px] truncate"
              >
                <option value="">All Firms</option>
                {companies.map((c) => (
                  <option key={c._id} value={c.firmCode}>
                    {c.firmName} {c.firmCode ? `(${c.firmCode})` : ""}
                  </option>
                ))}
              </select>
              <button
                onClick={fetchSummary}
                disabled={loading}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl py-2 px-4 text-[11px] font-black uppercase tracking-wide transition-colors shrink-0"
              >
                <FiRefreshCw size={12} className={loading ? "animate-spin" : ""} />
                {loading ? "Scanning..." : data ? "Rescan" : "Scan Data"}
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center items-center py-16">
              <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-blue-500"></div>
            </div>
          ) : !data ? (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm py-16 text-center text-slate-400 space-y-3">
              <FiBarChart2 className="mx-auto text-2xl text-slate-300" />
              <p className="text-xs uppercase font-black tracking-widest">Press "Scan Data" to load the business overview</p>
              <button
                onClick={fetchSummary}
                className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-2.5 px-5 text-[11px] font-black uppercase tracking-wide transition-colors"
              >
                <FiRefreshCw size={12} /> Scan Data
              </button>
            </div>
          ) : (
            <>
              {/* Row 1: Sales */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard
                  icon={<FiTrendingUp size={16} />}
                  label="Total Order Value"
                  value={`₹${formatMoney(data.totals.totalOrderValue)}`}
                  sub={`${formatInt(data.totals.orderCount)} orders`}
                  color="bg-blue-600"
                />
                <StatCard
                  icon={<FiClock size={16} />}
                  label="Today's Order Value"
                  value={`₹${formatMoney(data.today.todayOrderValue)}`}
                  sub={`${formatInt(data.today.todayOrderCount)} orders today`}
                  color="bg-cyan-600"
                />
                <StatCard
                  icon={<FiPackage size={16} />}
                  label="This Month's Order Value"
                  value={`₹${formatMoney(data.thisMonth.monthOrderValue)}`}
                  sub={`${formatInt(data.thisMonth.monthOrderCount)} orders this month`}
                  color="bg-indigo-600"
                />
                <StatCard
                  icon={<FiAlertCircle size={16} />}
                  label="Pending Orders"
                  value={formatInt(data.pending.pendingOrderCount)}
                  sub={`₹${formatMoney(data.pending.pendingOrderValue)} value`}
                  color="bg-amber-600"
                />
              </div>

              {/* Row 2: Payments */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard
                  icon={<FiCheckCircle size={16} />}
                  label="Received Payment"
                  value={`₹${formatMoney(data.totals.totalReceived)}`}
                  sub="all-time"
                  color="bg-emerald-600"
                />
                <StatCard
                  icon={<FiDollarSign size={16} />}
                  label="Pending Payment"
                  value={`₹${formatMoney(data.totals.pendingPaymentValue)}`}
                  sub="all-time"
                  color="bg-red-600"
                />
                <StatCard
                  icon={<FiDollarSign size={16} />}
                  label="Total Deducted"
                  value={`₹${formatMoney(data.totals.totalDeducted)}`}
                  sub="TDS + GST + Kasar, all-time"
                  color="bg-orange-600"
                />
                <StatCard
                  icon={<FiTruck size={16} />}
                  label="Today's Purchase Value"
                  value={`₹${formatMoney(data.purchase.todayPurchaseValue)}`}
                  sub={`${formatInt(data.purchase.openPurchaseRequests)} open purchase requests`}
                  color="bg-fuchsia-600"
                />
              </div>

              {/* Order Status Pipeline */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5 mb-4">
                  <FiBarChart2 className="text-blue-600" size={14} /> Order Status Pipeline
                </h3>
                {data.statusBreakdown.length === 0 ? (
                  <p className="text-xs text-slate-400 uppercase font-bold tracking-widest text-center py-6">No orders yet</p>
                ) : (
                  <div className="space-y-2.5">
                    {data.statusBreakdown.map((s) => (
                      <div key={s.status} className="flex items-center gap-1.5 sm:gap-3">
                        <span className="w-16 sm:w-36 shrink-0 text-[8px] sm:text-[10px] font-black uppercase text-slate-600 truncate">{s.status}</span>
                        <div className="flex-1 min-w-0 bg-slate-100 rounded-full h-5 overflow-hidden">
                          <div
                            className={`h-full ${STATUS_COLORS[s.status] || "bg-slate-500"} rounded-full transition-all`}
                            style={{ width: `${Math.max(4, (s.value / maxStatusValue) * 100)}%` }}
                          />
                        </div>
                        <span className="w-8 sm:w-16 shrink-0 text-right text-[8px] sm:text-[10px] font-bold text-slate-500">{formatInt(s.count)}</span>
                        <span className="w-20 sm:w-28 shrink-0 text-right text-[9px] sm:text-[11px] font-black text-slate-800 truncate" title={`₹${formatMoney(s.value)}`}>₹{formatMoney(s.value)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Bills Generated Today */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                    <FiFileText className="text-blue-600" size={14} /> Bills Generated Today
                  </h3>
                  <span className="text-[10px] font-black text-slate-500">
                    {formatInt(data.billsToday.totalCount)} bills · ₹{formatMoney(data.billsToday.totalValue)}
                  </span>
                </div>
                {data.billsToday.byFirm.length === 0 ? (
                  <p className="text-xs text-slate-400 uppercase font-bold tracking-widest text-center py-6">No bills generated today</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {data.billsToday.byFirm.map((f) => (
                      <div
                        key={f.firmCode}
                        className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2"
                      >
                        <span className="text-[11px] font-black text-slate-800 uppercase">{f.firmCode}</span>
                        <span className="text-[10px] font-bold text-blue-700">× {f.count}</span>
                        <span className="text-[10px] font-bold text-slate-400">₹{formatMoney(f.value)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Pending Bills by Firm + Bills Generated by Team Member */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                      <FiAlertCircle className="text-amber-600" size={14} /> Pending Bills — By Firm
                    </h3>
                    <span className="text-[10px] font-black text-slate-500">
                      {formatInt(data.pendingBillsByFirm.reduce((s, f) => s + f.count, 0))} bills ·{" "}
                      ₹{formatMoney(data.pendingBillsByFirm.reduce((s, f) => s + f.value, 0))}
                    </span>
                  </div>
                  {data.pendingBillsByFirm.length === 0 ? (
                    <p className="text-xs text-slate-400 uppercase font-bold tracking-widest text-center py-6">No pending bills</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {data.pendingBillsByFirm.map((f) => (
                        <div
                          key={f.firmCode}
                          className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2"
                        >
                          <span className="text-[11px] font-black text-slate-800 uppercase">{f.firmCode}</span>
                          <span className="text-[10px] font-bold text-amber-700">× {f.count}</span>
                          <span className="text-[10px] font-bold text-slate-400">₹{formatMoney(f.value)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                      <FiFileText className="text-blue-600" size={14} /> Bills Generated — By Team Member
                    </h3>
                  </div>

                  <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-2">Today</span>
                  {data.billsByUserToday.length === 0 ? (
                    <p className="text-xs text-slate-400 uppercase font-bold tracking-widest text-center py-3">No bills generated today yet</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {data.billsByUserToday.map((u) => (
                        <div
                          key={u.username}
                          className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2"
                        >
                          <span className="text-[11px] font-black text-slate-800 uppercase">{u.username}</span>
                          <span className="text-[10px] font-bold text-emerald-700">× {u.count}</span>
                          <span className="text-[10px] font-bold text-slate-400">₹{formatMoney(u.value)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mt-4 mb-2">All-time</span>
                  {data.billsByUser.length === 0 ? (
                    <p className="text-xs text-slate-400 uppercase font-bold tracking-widest text-center py-3">No bills generated yet</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {data.billsByUser.map((u) => (
                        <div
                          key={u.username}
                          className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2"
                        >
                          <span className="text-[11px] font-black text-slate-800 uppercase">{u.username}</span>
                          <span className="text-[10px] font-bold text-blue-700">× {u.count}</span>
                          <span className="text-[10px] font-bold text-slate-400">₹{formatMoney(u.value)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* GeM Sync Report */}
              {data.gemSync && (
                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5 mb-4">
                    <FiRefreshCw className="text-blue-600" size={14} /> GeM Sync Report
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-2">
                        Requirement Mapping Actions (All-Time)
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                          <span className="text-[10px] font-black text-emerald-700 uppercase">OK Link</span>
                          <span className="text-xs font-black text-emerald-800">{formatInt(data.gemSync.actions.okLink)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                          <span className="text-[10px] font-black text-amber-700 uppercase">Update Stock</span>
                          <span className="text-xs font-black text-amber-800">{formatInt(data.gemSync.actions.updateStock)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
                          <span className="text-[10px] font-black text-blue-700 uppercase">New Link</span>
                          <span className="text-xs font-black text-blue-800">{formatInt(data.gemSync.actions.newLink)}</span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-2">
                        Sync Checklist (Current)
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                          <span className="text-[10px] font-black text-slate-600 uppercase">Stock Update</span>
                          <span className="text-xs font-black text-amber-700">{formatInt(data.gemSync.checklist.stockUpdate.pending)} pending</span>
                          <span className="text-xs font-black text-emerald-700">{formatInt(data.gemSync.checklist.stockUpdate.synced)} synced</span>
                        </div>
                        <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                          <span className="text-[10px] font-black text-slate-600 uppercase">New Upload Link</span>
                          <span className="text-xs font-black text-amber-700">{formatInt(data.gemSync.checklist.newUploadLink.pending)} pending</span>
                          <span className="text-xs font-black text-emerald-700">{formatInt(data.gemSync.checklist.newUploadLink.synced)} synced</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {data.gemSync.byUser.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-2">
                        Requirement Mapping Actions — By User (All-Time)
                      </span>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                              <th className="py-2 px-3">User</th>
                              <th className="py-2 px-3 text-center">OK Link</th>
                              <th className="py-2 px-3 text-center">Update Stock</th>
                              <th className="py-2 px-3 text-center">New Link</th>
                              <th className="py-2 px-3 text-center">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {data.gemSync.byUser.map((u) => (
                              <tr key={u.username} className="hover:bg-blue-50/40 transition-colors">
                                <td className="py-2 px-3 font-black text-slate-800">{u.username}</td>
                                <td className="py-2 px-3 text-center font-mono font-bold text-emerald-700">{u.okLink || "—"}</td>
                                <td className="py-2 px-3 text-center font-mono font-bold text-amber-700">{u.updateStock || "—"}</td>
                                <td className="py-2 px-3 text-center font-mono font-bold text-blue-700">{u.newLink || "—"}</td>
                                <td className="py-2 px-3 text-center font-mono font-bold text-slate-800">{u.total}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Team Activity Today */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                    <FiUsers className="text-blue-600" size={14} /> Team Activity — Today
                  </h3>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Orders created, GeM Sync files uploaded / products completed, and order-status +
                    purchase actions logged today — per team member.
                  </p>
                </div>
                {data.teamActivity.length === 0 ? (
                  <div className="text-center py-10 text-slate-400 text-xs font-bold uppercase tracking-widest">
                    No activity logged today yet
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                          <th className="py-2.5 px-4">Team Member</th>
                          <th className="py-2.5 px-4 text-center">Orders Added</th>
                          <th className="py-2.5 px-4 text-center">Order Qty</th>
                          <th className="py-2.5 px-4 text-center">GeM Files Uploaded</th>
                          <th className="py-2.5 px-4 text-center">GeM Products Completed</th>
                          <th className="py-2.5 px-4 text-center">Other Actions</th>
                          <th className="py-2.5 px-4">Breakdown</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.teamActivity.map((row) => (
                          <tr key={row.username} className="hover:bg-blue-50/40 transition-colors">
                            <td className="py-2.5 px-4 font-black text-slate-800">{row.username}</td>
                            <td className="py-2.5 px-4 text-center font-mono font-bold text-blue-700">{row.ordersCreated || "—"}</td>
                            <td className="py-2.5 px-4 text-center font-mono text-slate-500">{row.ordersCreatedQty || "—"}</td>
                            <td className="py-2.5 px-4 text-center font-mono font-bold text-fuchsia-700">{row.filesUploaded || "—"}</td>
                            <td className="py-2.5 px-4 text-center font-mono font-bold text-emerald-700">{row.productsCompleted || "—"}</td>
                            <td className="py-2.5 px-4 text-center font-mono font-bold text-slate-700">{row.totalActions || "—"}</td>
                            <td className="py-2.5 px-4">
                              <div className="flex flex-wrap gap-1.5">
                                {Object.entries(row.actions).map(([action, count]) => (
                                  <span
                                    key={action}
                                    className="bg-slate-50 border border-slate-200 text-slate-600 text-[9px] font-black uppercase px-2 py-0.5 rounded-full"
                                  >
                                    {action} × {count}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Team Performance - per-member day-wise / month-wise trend */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                      <FiTrendingUp className="text-blue-600" size={14} /> Team Performance
                    </h3>
                    <p className="text-[10px] text-slate-400 mt-1">
                      {dailyBucketBy === "day" ? "Day-wise" : "Month-wise"} activity trend for the selected team member.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={selectedMember}
                      onChange={(e) => setSelectedMember(e.target.value)}
                      disabled={!perfData || perfData.length === 0}
                      className="bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-[11px] font-black uppercase text-slate-700 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                    >
                      {(perfData || []).map((r) => (
                        <option key={r.username} value={r.username}>
                          {r.username}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-1.5 bg-slate-100 rounded-xl p-1">
                      <button
                        onClick={() => setPerfRange("month")}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide transition-colors ${
                          perfRange === "month" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        This Month
                      </button>
                      <button
                        onClick={() => setPerfRange("year")}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide transition-colors ${
                          perfRange === "year" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        This Year
                      </button>
                    </div>
                  </div>
                </div>

                {perfLoading || dailyLoading ? (
                  <div className="flex justify-center items-center py-10">
                    <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-blue-500"></div>
                  </div>
                ) : !selectedMember || !dailySeries || dailySeries.length === 0 ? (
                  <p className="text-xs text-slate-400 uppercase font-bold tracking-widest text-center py-10">
                    No activity logged {perfRange === "month" ? "this month" : "this year"} yet
                  </p>
                ) : (
                  <div className="p-5">
                    <div className="overflow-x-auto">
                      <div className="min-w-[560px]">
                        <div className="flex items-end gap-1 h-48 border-b border-slate-200 pb-1">
                          {dailySeries.map((d) => {
                            const score = dayScore(d);
                            return (
                              <div key={d.bucket} className="flex-1 h-full flex items-end">
                                <div
                                  className={`w-full rounded-t transition-all ${score > 0 ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-100"}`}
                                  style={{ height: `${score > 0 ? Math.max(3, (score / maxDailyValue) * 100) : 2}%` }}
                                  title={`${d.bucket}: ${score} actions — ${d.ordersCreated} orders, ${d.filesUploaded} files, ${d.productsCompleted} products`}
                                />
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex gap-1 mt-1">
                          {dailySeries.map((d) => (
                            <span key={d.bucket} className="flex-1 text-center text-[8px] font-bold text-slate-400">
                              {formatBucketLabel(d.bucket, dailyBucketBy)}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <p className="text-[10px] font-bold text-slate-500 mt-4">
                      Total this {perfRange === "month" ? "month" : "year"}:{" "}
                      <span className="text-slate-800">{formatInt(dailySeries.reduce((s, d) => s + dayScore(d), 0))} actions</span>
                      {" · "}
                      {formatInt(dailySeries.reduce((s, d) => s + d.ordersCreated, 0))} orders
                      {" · "}
                      {formatInt(dailySeries.reduce((s, d) => s + d.filesUploaded, 0))} files
                      {" · "}
                      {formatInt(dailySeries.reduce((s, d) => s + d.productsCompleted, 0))} products
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </BlockGuard>
  );
}
