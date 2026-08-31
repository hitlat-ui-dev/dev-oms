"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { FiArrowLeft, FiTruck, FiCornerUpLeft, FiX, FiFilter } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";

interface DDEntry {
  _id: string;
  ddNumber: string;
  ddDate: string;
  amount: number;
  payeeName: string;
  firmBankAccount: { _id: string; firmCode: string; bankName: string; accountNumber: string };
  tenderReference: string;
  tenderStatus: string;
  status: string;
  courierSentDate?: string;
  courierTrackingNumber?: string;
}

const STATUS_LABEL: Record<string, string> = {
  issued: "Issued",
  sent: "Sent",
  pending_return: "Pending Return",
  returned_cancelled: "Returned & Cancelled",
  refund_credited: "Refund Credited",
};
const STATUS_COLOR: Record<string, string> = {
  issued: "bg-slate-100 text-slate-700 border-slate-300",
  sent: "bg-blue-50 text-blue-700 border-blue-300",
  pending_return: "bg-amber-50 text-amber-700 border-amber-300",
  returned_cancelled: "bg-purple-50 text-purple-700 border-purple-300",
  refund_credited: "bg-emerald-50 text-emerald-700 border-emerald-300",
};

const fmtMoney = (n: number) => (n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d?: string) => (d ? new Date(d).toLocaleDateString("en-IN") : "—");

type ModalKind = "sent" | "pending_return" | "returned_cancelled" | null;

export default function DDLedgerPage() {
  const [entries, setEntries] = useState<DDEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [companies, setCompanies] = useState<any[]>([]);
  const [firmFilter, setFirmFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [tenderFilter, setTenderFilter] = useState("");

  const [modal, setModal] = useState<{ kind: ModalKind; entry: DDEntry | null }>({ kind: null, entry: null });
  const [modalForm, setModalForm] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (firmFilter) params.set("firmCode", firmFilter);
    if (statusFilter) params.set("status", statusFilter);
    if (tenderFilter) params.set("tenderStatus", tenderFilter);
    fetch(`/api/dd-entries?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => setEntries(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, [firmFilter, statusFilter, tenderFilter]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    fetch("/api/companies").then((r) => r.json()).then((d) => setCompanies(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const updateTenderStatus = async (entry: DDEntry, tenderStatus: string) => {
    await fetch(`/api/dd-entries/${entry._id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenderStatus }),
    });
    load();
  };

  const openModal = (kind: ModalKind, entry: DDEntry) => {
    setModal({ kind, entry });
    setModalForm(
      kind === "sent"
        ? { courierSentDate: new Date().toISOString().slice(0, 10), courierTrackingNumber: "" }
        : kind === "returned_cancelled"
        ? { returnedDate: new Date().toISOString().slice(0, 10), cancellationCharge: "" }
        : {}
    );
  };

  const submitModal = async () => {
    if (!modal.entry || !modal.kind) return;
    const body: Record<string, any> = { status: modal.kind };
    if (modal.kind === "sent") {
      body.courierSentDate = modalForm.courierSentDate;
      body.courierTrackingNumber = modalForm.courierTrackingNumber;
    }
    if (modal.kind === "returned_cancelled") {
      body.returnedDate = modalForm.returnedDate;
      body.cancellationCharge = modalForm.cancellationCharge ? Number(modalForm.cancellationCharge) : 0;
    }
    const res = await fetch(`/api/dd-entries/${modal.entry._id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Update failed");
      return;
    }
    setModal({ kind: null, entry: null });
    load();
  };

  return (
    <BlockGuard permission="accountStatements">
      <div className="p-4 md:p-8 bg-slate-50 min-h-screen">
        <div className="max-w-7xl mx-auto flex flex-col gap-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <Link href="/dashboard/account/dd-tracking" className="flex items-center gap-2 text-slate-500 hover:text-blue-600 text-xs mb-2 transition-colors w-fit">
                <FiArrowLeft /> Back to DD Tracking
              </Link>
              <h1 className="text-xl font-black uppercase tracking-tight text-slate-900">DD Ledger</h1>
              <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mt-0.5">{entries.length} entries</p>
            </div>
            <Link
              href="/dashboard/account/dd-tracking/new"
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-2.5 px-4 text-[11px] font-black uppercase tracking-wide transition-colors"
            >
              + New DD Entry
            </Link>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex flex-wrap items-center gap-2">
            <FiFilter className="text-slate-400" size={14} />
            <select value={firmFilter} onChange={(e) => setFirmFilter(e.target.value)} className={filterCls}>
              <option value="">All Firms</option>
              {companies.map((c) => (
                <option key={c._id} value={c.firmCode}>{c.firmName} ({c.firmCode})</option>
              ))}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={filterCls}>
              <option value="">All DD Status</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select value={tenderFilter} onChange={(e) => setTenderFilter(e.target.value)} className={filterCls}>
              <option value="">All Tender Status</option>
              {["ongoing", "won", "lost", "cancelled", "disqualified"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            {loading ? (
              <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-5 w-5 border-t-2 border-blue-500"></div></div>
            ) : entries.length === 0 ? (
              <p className="text-xs text-slate-400 uppercase font-bold tracking-widest text-center py-10">No DD entries found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                      <th className="py-2.5 px-3">DD No.</th>
                      <th className="py-2.5 px-3">Firm</th>
                      <th className="py-2.5 px-3">Payee</th>
                      <th className="py-2.5 px-3 text-right">Amount</th>
                      <th className="py-2.5 px-3">DD Date</th>
                      <th className="py-2.5 px-3">Courier Sent</th>
                      <th className="py-2.5 px-3">Tender Ref</th>
                      <th className="py-2.5 px-3">Tender Status</th>
                      <th className="py-2.5 px-3">DD Status</th>
                      <th className="py-2.5 px-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {entries.map((e) => (
                      <tr key={e._id} className="hover:bg-blue-50/40 transition-colors">
                        <td className="py-2.5 px-3 font-black text-slate-800">{e.ddNumber}</td>
                        <td className="py-2.5 px-3 font-bold text-slate-700">{e.firmBankAccount?.firmCode || "—"}</td>
                        <td className="py-2.5 px-3 text-slate-600">{e.payeeName}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-800">₹{fmtMoney(e.amount)}</td>
                        <td className="py-2.5 px-3 text-slate-500">{fmtDate(e.ddDate)}</td>
                        <td className="py-2.5 px-3 text-slate-500">{fmtDate(e.courierSentDate)}</td>
                        <td className="py-2.5 px-3 text-slate-600">{e.tenderReference}</td>
                        <td className="py-2.5 px-3">
                          <select
                            value={e.tenderStatus}
                            onChange={(ev) => updateTenderStatus(e, ev.target.value)}
                            className="bg-slate-50 border border-slate-200 rounded-lg py-1 px-2 text-[10px] font-bold text-slate-700"
                          >
                            {["ongoing", "won", "lost", "cancelled", "disqualified"].map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`inline-block border text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${STATUS_COLOR[e.status]}`}>
                            {STATUS_LABEL[e.status]}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1.5">
                            {e.status === "issued" && (
                              <button onClick={() => openModal("sent", e)} className="flex items-center gap-1 p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-[10px] font-black uppercase px-2">
                                <FiTruck size={11} /> Mark Sent
                              </button>
                            )}
                            {e.status === "sent" && (
                              <>
                                <button onClick={() => openModal("pending_return", e)} className="p-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-[10px] font-black uppercase px-2">
                                  Pending Return
                                </button>
                                <button onClick={() => openModal("returned_cancelled", e)} className="flex items-center gap-1 p-1.5 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-[10px] font-black uppercase px-2">
                                  <FiCornerUpLeft size={11} /> Returned
                                </button>
                              </>
                            )}
                            {e.status === "pending_return" && (
                              <button onClick={() => openModal("returned_cancelled", e)} className="flex items-center gap-1 p-1.5 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-[10px] font-black uppercase px-2">
                                <FiCornerUpLeft size={11} /> Returned
                              </button>
                            )}
                            {e.status === "returned_cancelled" && (
                              <Link href="/dashboard/account/dd-tracking/bank-match" className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-[10px] font-black uppercase px-2">
                                Match Refund →
                              </Link>
                            )}
                            {e.status === "refund_credited" && <span className="text-[10px] font-bold text-emerald-600">✓ Done</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {modal.kind && modal.entry && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setModal({ kind: null, entry: null })}>
          <div className="bg-white rounded-2xl shadow-2xl p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-900">
                {modal.kind === "sent" ? "Mark Courier Sent" : modal.kind === "returned_cancelled" ? "Mark Returned & Cancelled" : "Mark Pending Return"}
              </h3>
              <button onClick={() => setModal({ kind: null, entry: null })} className="text-slate-400 hover:text-slate-700"><FiX size={18} /></button>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">DD #{modal.entry.ddNumber} — {modal.entry.payeeName}</p>

            {modal.kind === "sent" && (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-1">Courier Sent Date</label>
                  <input type="date" value={modalForm.courierSentDate || ""} onChange={(e) => setModalForm({ ...modalForm, courierSentDate: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-1">Tracking Number</label>
                  <input value={modalForm.courierTrackingNumber || ""} onChange={(e) => setModalForm({ ...modalForm, courierTrackingNumber: e.target.value })} className={inputCls} />
                </div>
              </div>
            )}

            {modal.kind === "returned_cancelled" && (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-1">Returned Date</label>
                  <input type="date" value={modalForm.returnedDate || ""} onChange={(e) => setModalForm({ ...modalForm, returnedDate: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-1">Cancellation Charge (bank fee)</label>
                  <input type="number" value={modalForm.cancellationCharge || ""} onChange={(e) => setModalForm({ ...modalForm, cancellationCharge: e.target.value })} className={inputCls} />
                </div>
              </div>
            )}

            {modal.kind === "pending_return" && (
              <p className="text-xs text-slate-500">Flags this DD as still with the buyer, tender ended but not yet physically returned.</p>
            )}

            <button onClick={submitModal} className="mt-4 w-full bg-slate-900 hover:bg-slate-800 text-white rounded-xl py-2.5 text-[11px] font-black uppercase tracking-wide transition-colors">
              Confirm
            </button>
          </div>
        </div>
      )}
    </BlockGuard>
  );
}

const filterCls = "bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-[11px] font-bold text-slate-700 focus:outline-none focus:border-blue-500";
const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs font-bold text-slate-700 focus:outline-none focus:border-blue-500";
