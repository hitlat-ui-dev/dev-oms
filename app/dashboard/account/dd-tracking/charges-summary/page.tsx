"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { FiArrowLeft, FiDollarSign } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";

interface PerDD {
  _id: string;
  ddNumber: string;
  ddDate: string;
  firmCode: string;
  issuanceCharge: number;
  cancellationCharge: number;
  totalCharge: number;
}
interface ByFirm {
  firmCode: string;
  issuanceCharge: number;
  cancellationCharge: number;
  totalCharge: number;
  count: number;
}
interface GrandTotal {
  issuanceCharge: number;
  cancellationCharge: number;
  totalCharge: number;
  count: number;
}

const fmtMoney = (n: number) => (n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d?: string) => (d ? new Date(d).toLocaleDateString("en-IN") : "—");

export default function ChargesSummaryPage() {
  const [grandTotal, setGrandTotal] = useState<GrandTotal | null>(null);
  const [byFirm, setByFirm] = useState<ByFirm[]>([]);
  const [perDD, setPerDD] = useState<PerDD[]>([]);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    fetch(`/api/dd-entries/charges-summary?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        setGrandTotal(d.grandTotal || null);
        setByFirm(Array.isArray(d.byFirm) ? d.byFirm : []);
        setPerDD(Array.isArray(d.perDD) ? d.perDD : []);
      })
      .finally(() => setLoading(false));
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <BlockGuard permission="accountStatements">
      <div className="p-4 md:p-8 bg-slate-50 min-h-screen">
        <div className="max-w-5xl mx-auto flex flex-col gap-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <Link href="/dashboard/account/dd-tracking" className="flex items-center gap-2 text-slate-500 hover:text-blue-600 text-xs mb-2 transition-colors w-fit">
                <FiArrowLeft /> Back to DD Tracking
              </Link>
              <h1 className="text-xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
                <FiDollarSign className="text-orange-600" /> DD Bank Charges Summary
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-white border border-slate-200 rounded-lg py-1.5 px-2 text-xs font-bold text-slate-700" />
              <span className="text-slate-400 text-xs">to</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-white border border-slate-200 rounded-lg py-1.5 px-2 text-xs font-bold text-slate-700" />
            </div>
          </div>

          {/* Grand total banner */}
          <div className="bg-[#0f172a] rounded-2xl shadow-lg p-6 text-white">
            <p className="text-[10px] font-black uppercase tracking-widest text-white/60 mb-1">
              Grand Total Bank Charges {grandTotal ? `· ${grandTotal.count} DDs` : ""}
            </p>
            <p className="text-3xl font-black">₹{fmtMoney(grandTotal?.totalCharge || 0)}</p>
            <div className="flex gap-6 mt-3">
              <div>
                <p className="text-[9px] font-black uppercase text-white/50">Issuance</p>
                <p className="text-sm font-black">₹{fmtMoney(grandTotal?.issuanceCharge || 0)}</p>
              </div>
              <div>
                <p className="text-[9px] font-black uppercase text-white/50">Cancellation</p>
                <p className="text-sm font-black">₹{fmtMoney(grandTotal?.cancellationCharge || 0)}</p>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-5 w-5 border-t-2 border-blue-500"></div></div>
          ) : (
            <>
              {/* Firm-wise subtotal */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-900">Firm-wise Subtotal</h3>
                </div>
                {byFirm.length === 0 ? (
                  <p className="text-xs text-slate-400 uppercase font-bold tracking-widest text-center py-8">No data</p>
                ) : (
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                        <th className="py-2.5 px-4">Firm</th>
                        <th className="py-2.5 px-4 text-right">DDs</th>
                        <th className="py-2.5 px-4 text-right">Issuance</th>
                        <th className="py-2.5 px-4 text-right">Cancellation</th>
                        <th className="py-2.5 px-4 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {byFirm.map((f) => (
                        <tr key={f.firmCode} className="hover:bg-blue-50/40 transition-colors">
                          <td className="py-2.5 px-4 font-black text-slate-800">{f.firmCode}</td>
                          <td className="py-2.5 px-4 text-right font-mono text-slate-600">{f.count}</td>
                          <td className="py-2.5 px-4 text-right font-mono text-slate-700">₹{fmtMoney(f.issuanceCharge)}</td>
                          <td className="py-2.5 px-4 text-right font-mono text-slate-700">₹{fmtMoney(f.cancellationCharge)}</td>
                          <td className="py-2.5 px-4 text-right font-mono font-black text-slate-900">₹{fmtMoney(f.totalCharge)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Per-DD breakdown */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-900">Per-DD Breakdown</h3>
                </div>
                {perDD.length === 0 ? (
                  <p className="text-xs text-slate-400 uppercase font-bold tracking-widest text-center py-8">No data</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                          <th className="py-2.5 px-4">DD No.</th>
                          <th className="py-2.5 px-4">Firm</th>
                          <th className="py-2.5 px-4">DD Date</th>
                          <th className="py-2.5 px-4 text-right">Issuance</th>
                          <th className="py-2.5 px-4 text-right">Cancellation</th>
                          <th className="py-2.5 px-4 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {perDD.map((d) => (
                          <tr key={d._id} className="hover:bg-blue-50/40 transition-colors">
                            <td className="py-2.5 px-4 font-black text-slate-800">{d.ddNumber}</td>
                            <td className="py-2.5 px-4 font-bold text-slate-700">{d.firmCode}</td>
                            <td className="py-2.5 px-4 text-slate-500">{fmtDate(d.ddDate)}</td>
                            <td className="py-2.5 px-4 text-right font-mono text-slate-700">₹{fmtMoney(d.issuanceCharge)}</td>
                            <td className="py-2.5 px-4 text-right font-mono text-slate-700">₹{fmtMoney(d.cancellationCharge)}</td>
                            <td className="py-2.5 px-4 text-right font-mono font-black text-slate-900">₹{fmtMoney(d.totalCharge)}</td>
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
