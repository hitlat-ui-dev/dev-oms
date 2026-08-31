"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { FiArrowLeft, FiPlus, FiEdit2, FiTrash2, FiX, FiSave } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";

interface FirmBankAccount {
  _id: string;
  firmCode: string;
  bankName: string;
  accountNumber: string;
  branchName?: string;
}

const maskAccount = (num: string) => (num && num.length > 4 ? `••••${num.slice(-4)}` : num);

const emptyForm = { firmCode: "", bankName: "", accountNumber: "", branchName: "" };

export default function FirmBankAccountsPage() {
  const [accounts, setAccounts] = useState<FirmBankAccount[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/firm-bank-accounts")
      .then((r) => r.json())
      .then((d) => setAccounts(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    fetch("/api/companies").then((r) => r.json()).then((d) => setCompanies(Array.isArray(d) ? d : [])).catch(() => {});
  }, [load]);

  const startAdd = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
    setError("");
  };

  const startEdit = (a: FirmBankAccount) => {
    setForm({ firmCode: a.firmCode, bankName: a.bankName, accountNumber: a.accountNumber, branchName: a.branchName || "" });
    setEditingId(a._id);
    setShowForm(true);
    setError("");
  };

  const submit = async () => {
    if (!form.firmCode || !form.bankName || !form.accountNumber) {
      setError("Firm, bank name and account number are required.");
      return;
    }
    setError("");
    const url = editingId ? `/api/firm-bank-accounts/${editingId}` : "/api/firm-bank-accounts";
    const method = editingId ? "PUT" : "POST";
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to save.");
      return;
    }
    setShowForm(false);
    load();
  };

  const remove = async (a: FirmBankAccount) => {
    if (!confirm(`Delete bank account mapping for ${a.firmCode} (${a.bankName})?`)) return;
    const res = await fetch(`/api/firm-bank-accounts/${a._id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Failed to delete.");
      return;
    }
    load();
  };

  const firmName = (firmCode: string) => companies.find((c) => c.firmCode === firmCode)?.firmName || "";

  return (
    <BlockGuard permission="accountStatements">
      <div className="p-4 md:p-8 bg-slate-50 min-h-screen">
        <div className="max-w-4xl mx-auto flex flex-col gap-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <Link href="/dashboard/account/dd-tracking" className="flex items-center gap-2 text-slate-500 hover:text-blue-600 text-xs mb-2 transition-colors w-fit">
                <FiArrowLeft /> Back to DD Tracking
              </Link>
              <h1 className="text-xl font-black uppercase tracking-tight text-slate-900">Firm ↔ Bank Account Mapping</h1>
              <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mt-0.5">Which bank account each firm&apos;s DDs are issued from</p>
            </div>
            <button
              onClick={startAdd}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-2.5 px-4 text-[11px] font-black uppercase tracking-wide transition-colors"
            >
              <FiPlus size={14} /> Add Mapping
            </button>
          </div>

          {showForm && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-900">{editingId ? "Edit Mapping" : "New Mapping"}</h3>
                <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-700"><FiX size={18} /></button>
              </div>
              {error && <p className="text-xs font-bold text-red-600 mb-3">{error}</p>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-1">Firm</label>
                  <select
                    value={form.firmCode}
                    onChange={(e) => setForm({ ...form, firmCode: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs font-bold text-slate-700 focus:outline-none focus:border-blue-500"
                  >
                    <option value="">Select firm</option>
                    {companies.map((c) => (
                      <option key={c._id} value={c.firmCode}>{c.firmName} ({c.firmCode})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-1">Bank Name</label>
                  <input
                    value={form.bankName}
                    onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs font-bold text-slate-700 focus:outline-none focus:border-blue-500"
                    placeholder="e.g. HDFC Bank"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-1">Account Number</label>
                  <input
                    value={form.accountNumber}
                    onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs font-bold text-slate-700 focus:outline-none focus:border-blue-500"
                    placeholder="Full account number"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-1">Branch (optional)</label>
                  <input
                    value={form.branchName}
                    onChange={(e) => setForm({ ...form, branchName: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs font-bold text-slate-700 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <button
                onClick={submit}
                className="mt-4 flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl py-2.5 px-4 text-[11px] font-black uppercase tracking-wide transition-colors"
              >
                <FiSave size={14} /> Save
              </button>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            {loading ? (
              <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-5 w-5 border-t-2 border-blue-500"></div></div>
            ) : accounts.length === 0 ? (
              <p className="text-xs text-slate-400 uppercase font-bold tracking-widest text-center py-10">No firm bank accounts mapped yet</p>
            ) : (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                    <th className="py-2.5 px-4">Firm</th>
                    <th className="py-2.5 px-4">Bank</th>
                    <th className="py-2.5 px-4">Account No.</th>
                    <th className="py-2.5 px-4">Branch</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {accounts.map((a) => (
                    <tr key={a._id} className="hover:bg-blue-50/40 transition-colors">
                      <td className="py-2.5 px-4 font-black text-slate-800">
                        {a.firmCode} <span className="text-slate-400 font-bold">{firmName(a.firmCode)}</span>
                      </td>
                      <td className="py-2.5 px-4 font-bold text-slate-700">{a.bankName}</td>
                      <td className="py-2.5 px-4 font-mono text-slate-600">{maskAccount(a.accountNumber)}</td>
                      <td className="py-2.5 px-4 text-slate-500">{a.branchName || "—"}</td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => startEdit(a)} className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200"><FiEdit2 size={12} /></button>
                          <button onClick={() => remove(a)} className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 border border-red-200"><FiTrash2 size={12} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </BlockGuard>
  );
}
