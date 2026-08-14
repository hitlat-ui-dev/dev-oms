"use client";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { FiArrowLeft, FiList, FiSearch } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";

interface LedgerRow {
  instituteName: string;
  totalOrders: number;
  totalValue: number;
  paidValue: number;
  pendingValue: number;
  firmCodes: string[];
}

const formatMoney = (n: number) =>
  (n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function LedgerPage() {
  const [companies, setCompanies] = useState<any[]>([]);
  const [firmFilter, setFirmFilter] = useState("");
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [instituteSearch, setInstituteSearch] = useState("");

  useEffect(() => {
    fetch("/api/companies")
      .then((res) => res.json())
      .then((data) => setCompanies(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load firms", err));
  }, []);

  useEffect(() => {
    setLoading(true);
    const url = firmFilter ? `/api/account-ledger?firmCode=${encodeURIComponent(firmFilter)}` : "/api/account-ledger";
    fetch(url)
      .then((res) => res.json())
      .then((data) => setLedger(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load ledger", err))
      .finally(() => setLoading(false));
  }, [firmFilter]);

  const filteredLedger = useMemo(() => {
    const q = instituteSearch.trim().toLowerCase();
    if (!q) return ledger;
    return ledger.filter((row) => row.instituteName.toLowerCase().includes(q));
  }, [ledger, instituteSearch]);

  const grandTotals = useMemo(() => {
    return filteredLedger.reduce(
      (acc, row) => ({
        orders: acc.orders + row.totalOrders,
        value: acc.value + row.totalValue,
        paid: acc.paid + row.paidValue,
        pending: acc.pending + row.pendingValue,
      }),
      { orders: 0, value: 0, paid: 0, pending: 0 }
    );
  }, [filteredLedger]);

  return (
    <BlockGuard
      permission="accountStatements"
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
        <div className="max-w-6xl mx-auto flex flex-col gap-6">
          {/* Header */}
          <div>
            <Link href="/dashboard/account" className="flex items-center gap-2 text-slate-500 hover:text-blue-600 text-xs mb-2 transition-colors w-fit">
              <FiArrowLeft /> Back to Account
            </Link>
            <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
              <FiList className="text-blue-600" /> Ledger
            </h1>
            <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mt-0.5">
              Institute-wise Order Summary
            </p>
          </div>

          {/* Filters */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 flex flex-col sm:flex-row gap-3">
            <div className="flex flex-col gap-1 sm:w-64">
              <label className="text-[9px] font-black uppercase tracking-wider text-slate-500">Firm</label>
              <select
                value={firmFilter}
                onChange={(e) => setFirmFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-xs text-slate-900 focus:outline-none focus:border-blue-500 font-bold"
              >
                <option value="">All Firms</option>
                {companies.map((c) => (
                  <option key={c._id} value={c.firmCode}>
                    {c.firmName} {c.firmCode ? `(${c.firmCode})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1 flex-1">
              <label className="text-[9px] font-black uppercase tracking-wider text-slate-500">Search Institute</label>
              <div className="relative">
                <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                <input
                  type="text"
                  placeholder="Search institute name..."
                  value={instituteSearch}
                  onChange={(e) => setInstituteSearch(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pl-9 pr-3 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500 font-semibold"
                />
              </div>
            </div>
          </div>

          {/* Grand Totals */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block">Institutes</span>
              <span className="text-lg font-black text-slate-800 block mt-0.5">{filteredLedger.length}</span>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block">Total Orders</span>
              <span className="text-lg font-black text-slate-800 block mt-0.5">{grandTotals.orders}</span>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <span className="text-[9px] font-black uppercase text-blue-600 tracking-wider block">Total Value</span>
              <span className="text-lg font-black text-blue-800 block mt-0.5">₹{formatMoney(grandTotals.value)}</span>
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
              <span className="text-[9px] font-black uppercase text-orange-600 tracking-wider block">Pending Payment</span>
              <span className="text-lg font-black text-orange-800 block mt-0.5">₹{formatMoney(grandTotals.pending)}</span>
            </div>
          </div>

          {/* Ledger Table */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            {loading ? (
              <div className="flex justify-center items-center py-12">
                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-blue-500"></div>
              </div>
            ) : filteredLedger.length === 0 ? (
              <div className="text-center py-12 text-slate-400 space-y-2">
                <FiList className="mx-auto text-2xl text-slate-300" />
                <p className="text-xs uppercase font-black tracking-widest">No orders found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                      <th className="py-3 px-5">Institute</th>
                      <th className="py-3 px-5">Firm(s)</th>
                      <th className="py-3 px-5 text-center">Total Orders</th>
                      <th className="py-3 px-5 text-right">Total Value</th>
                      <th className="py-3 px-5 text-right">Paid</th>
                      <th className="py-3 px-5 text-right">Pending</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredLedger.map((row) => (
                      <tr key={row.instituteName} className="hover:bg-blue-50/40 transition-colors">
                        <td className="py-3.5 px-5 font-bold text-slate-800">{row.instituteName}</td>
                        <td className="py-3.5 px-5">
                          <div className="flex flex-wrap gap-1">
                            {row.firmCodes.map((code) => (
                              <span
                                key={code}
                                className="bg-slate-100 border border-slate-200 text-slate-600 text-[9px] font-black px-1.5 py-0.5 rounded"
                              >
                                {code}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3.5 px-5 text-center font-mono text-slate-600">{row.totalOrders}</td>
                        <td className="py-3.5 px-5 text-right font-mono font-bold text-slate-800">₹{formatMoney(row.totalValue)}</td>
                        <td className="py-3.5 px-5 text-right font-mono font-bold text-emerald-600">₹{formatMoney(row.paidValue)}</td>
                        <td className="py-3.5 px-5 text-right font-mono font-bold text-orange-600">₹{formatMoney(row.pendingValue)}</td>
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
