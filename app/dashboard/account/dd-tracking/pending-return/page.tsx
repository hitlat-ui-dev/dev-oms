"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { FiArrowLeft, FiAlertTriangle } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";

interface Row {
  _id: string;
  ddNumber: string;
  amount: number;
  payeeName: string;
  firmBankAccount: { firmCode: string; bankName: string };
  tenderReference: string;
  tenderStatus: string;
  status: string;
  pendingSince: string;
  pendingDays: number;
  overdue: boolean;
}

const fmtMoney = (n: number) => (n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d?: string) => (d ? new Date(d).toLocaleDateString("en-IN") : "—");

export default function PendingReturnReportPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [threshold, setThreshold] = useState(30);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/dd-entries/pending-return?thresholdDays=${threshold}`)
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d.entries) ? d.entries : []))
      .finally(() => setLoading(false));
  }, [threshold]);

  useEffect(() => {
    load();
  }, [load]);

  const totalValue = rows.reduce((s, r) => s + r.amount, 0);
  const overdueCount = rows.filter((r) => r.overdue).length;

  return (
    <BlockGuard permission="accountStatements">
      <div className="p-4 md:p-8 bg-slate-50 min-h-screen">
        <div className="max-w-6xl mx-auto flex flex-col gap-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <Link href="/dashboard/account/dd-tracking" className="flex items-center gap-2 text-slate-500 hover:text-blue-600 text-xs mb-2 transition-colors w-fit">
                <FiArrowLeft /> Back to DD Tracking
              </Link>
              <h1 className="text-xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
                <FiAlertTriangle className="text-red-600" /> Pending Return Report
              </h1>
              <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mt-0.5">
                Tender ended, DD still with buyer — {rows.length} entries · ₹{fmtMoney(totalValue)} · {overdueCount} overdue
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-black uppercase text-slate-500">Overdue threshold (days)</label>
              <input
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value) || 30)}
                className="w-16 bg-white border border-slate-200 rounded-lg py-1.5 px-2 text-xs font-bold text-slate-700"
              />
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            {loading ? (
              <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-5 w-5 border-t-2 border-blue-500"></div></div>
            ) : rows.length === 0 ? (
              <p className="text-xs text-slate-400 uppercase font-bold tracking-widest text-center py-10">No DDs pending return — all clear</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                      <th className="py-2.5 px-3">DD No.</th>
                      <th className="py-2.5 px-3">Firm</th>
                      <th className="py-2.5 px-3">Payee</th>
                      <th className="py-2.5 px-3 text-right">Amount</th>
                      <th className="py-2.5 px-3">Tender Ref</th>
                      <th className="py-2.5 px-3">Tender Status</th>
                      <th className="py-2.5 px-3">Pending Since</th>
                      <th className="py-2.5 px-3 text-right">Days Pending</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r) => (
                      <tr key={r._id} className={r.overdue ? "bg-red-50 hover:bg-red-100/70 transition-colors" : "hover:bg-blue-50/40 transition-colors"}>
                        <td className="py-2.5 px-3 font-black text-slate-800">{r.ddNumber}</td>
                        <td className="py-2.5 px-3 font-bold text-slate-700">{r.firmBankAccount?.firmCode || "—"}</td>
                        <td className="py-2.5 px-3 text-slate-600">{r.payeeName}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-800">₹{fmtMoney(r.amount)}</td>
                        <td className="py-2.5 px-3 text-slate-600">{r.tenderReference}</td>
                        <td className="py-2.5 px-3">
                          <span className="inline-block border border-slate-300 bg-slate-100 text-slate-700 text-[9px] font-black uppercase px-2 py-0.5 rounded-full">{r.tenderStatus}</span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-500">{fmtDate(r.pendingSince)}</td>
                        <td className={`py-2.5 px-3 text-right font-mono font-black ${r.overdue ? "text-red-700" : "text-slate-700"}`}>{r.pendingDays}d</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </BlockGuard>
  );
}
