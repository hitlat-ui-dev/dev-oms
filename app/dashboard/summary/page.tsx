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
    todayOrderQty: number;
    todayOrderCount: number;
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
        <span className="text-lg font-black text-slate-800 block leading-tight mt-0.5">{value}</span>
        {sub && <span className="text-[10px] text-slate-400 font-bold block mt-0.5">{sub}</span>}
      </div>
    </div>
  );
}

export default function SummaryDashboardPage() {
  const [companies, setCompanies] = useState<any[]>([]);
  const [firmFilter, setFirmFilter] = useState("");
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(false);

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

  // No auto-run on mount - this aggregates across sellerorders/items/gem_sheets
  // in full, so it only scans when the button below is explicitly pressed.
  const maxStatusValue = useMemo(
    () => Math.max(1, ...(data?.statusBreakdown || []).map((s) => s.value)),
    [data]
  );

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
            <div className="flex items-center gap-2">
              <select
                value={firmFilter}
                onChange={(e) => setFirmFilter(e.target.value)}
                className="bg-white border border-slate-200 rounded-xl py-2 px-3 text-xs text-slate-700 focus:outline-none focus:border-blue-500 font-bold"
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
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl py-2 px-4 text-[11px] font-black uppercase tracking-wide transition-colors"
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
                  label="Today's Order Qty"
                  value={formatInt(data.today.todayOrderQty)}
                  sub="units placed today"
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
                      <div key={s.status} className="flex items-center gap-3">
                        <span className="w-36 shrink-0 text-[10px] font-black uppercase text-slate-600 truncate">{s.status}</span>
                        <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                          <div
                            className={`h-full ${STATUS_COLORS[s.status] || "bg-slate-500"} rounded-full transition-all`}
                            style={{ width: `${Math.max(4, (s.value / maxStatusValue) * 100)}%` }}
                          />
                        </div>
                        <span className="w-16 shrink-0 text-right text-[10px] font-bold text-slate-500">{formatInt(s.count)}</span>
                        <span className="w-28 shrink-0 text-right text-[11px] font-black text-slate-800">₹{formatMoney(s.value)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

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
            </>
          )}
        </div>
      </div>
    </BlockGuard>
  );
}
