"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { FiArrowLeft, FiTruck, FiCornerUpLeft, FiX, FiFilter, FiEdit3, FiUpload, FiSave, FiLoader, FiCheckCircle } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";

interface DDEntry {
  _id: string;
  ddNumber: string;
  ddDate: string;
  amount: number;
  payeeName: string;
  firmBankAccount: { _id: string; firmCode: string; bankName: string; accountNumber: string };
  seller?: { _id: string; instituteName: string } | null;
  tenderReference: string;
  purpose: string;
  issuanceCharge?: number;
  notes?: string;
  scannedDocumentUrl?: string;
  tenderStatus: string;
  status: string;
  courierSentDate?: string;
  courierTrackingNumber?: string;
}

interface FirmBankAccount {
  _id: string;
  firmCode: string;
  bankName: string;
  accountNumber: string;
}

interface Seller {
  _id: string;
  instituteName: string;
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

type ModalKind = "sent" | "pending_return" | "returned_cancelled" | "entry" | null;

const emptyEntryForm = {
  ddNumber: "",
  ddDate: "",
  amount: "",
  payeeName: "",
  firmBankAccount: "",
  seller: "",
  tenderReference: "",
  purpose: "EMD",
  issuanceCharge: "",
  notes: "",
  scannedDocumentUrl: "",
};

export default function DDLedgerPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<DDEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [companies, setCompanies] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<FirmBankAccount[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [firmFilter, setFirmFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [tenderFilter, setTenderFilter] = useState("");

  const [modal, setModal] = useState<{ kind: ModalKind; entry: DDEntry | null }>({ kind: null, entry: null });
  const [modalForm, setModalForm] = useState<Record<string, string>>({});

  // Entry (create/edit) modal — separate state from the lightweight status
  // modals above since it carries its own upload/validation flow.
  const [entryForm, setEntryForm] = useState(emptyEntryForm);
  const [editingEntry, setEditingEntry] = useState<DDEntry | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [entryError, setEntryError] = useState("");

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
    fetch("/api/firm-bank-accounts").then((r) => r.json()).then((d) => setAccounts(Array.isArray(d) ? d : [])).catch(() => {});
    fetch("/api/sellers").then((r) => r.json()).then((d) => setSellers(Array.isArray(d) ? d : [])).catch(() => {});
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

  const openCreateEntry = () => {
    setEditingEntry(null);
    setEntryForm(emptyEntryForm);
    setPreviewUrl(null);
    setScanError("");
    setEntryError("");
    setModal({ kind: "entry", entry: null });
  };

  const openEditEntry = (entry: DDEntry) => {
    setEditingEntry(entry);
    setEntryForm({
      ddNumber: entry.ddNumber || "",
      ddDate: entry.ddDate ? entry.ddDate.slice(0, 10) : "",
      amount: entry.amount != null ? String(entry.amount) : "",
      payeeName: entry.payeeName || "",
      firmBankAccount: entry.firmBankAccount?._id || "",
      seller: entry.seller?._id || "",
      tenderReference: entry.tenderReference || "",
      purpose: entry.purpose || "EMD",
      issuanceCharge: entry.issuanceCharge ? String(entry.issuanceCharge) : "",
      notes: entry.notes || "",
      scannedDocumentUrl: entry.scannedDocumentUrl || "",
    });
    setPreviewUrl(null);
    setScanError("");
    setEntryError("");
    setModal({ kind: "entry", entry });
  };

  const closeEntryModal = () => {
    setModal({ kind: null, entry: null });
    setEditingEntry(null);
    setEntryForm(emptyEntryForm);
    setPreviewUrl(null);
  };

  const handleScan = async (file: File) => {
    setScanning(true);
    setScanError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/dd-entries/scan", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setEntryForm((f) => ({ ...f, scannedDocumentUrl: data.scannedDocumentUrl }));
      setPreviewUrl(data.previewUrl || null);
    } catch (err: any) {
      setScanError(err.message || "Upload failed");
    } finally {
      setScanning(false);
    }
  };

  const submitEntry = async () => {
    if (!entryForm.ddNumber || !entryForm.ddDate || !entryForm.amount || !entryForm.payeeName || !entryForm.firmBankAccount || !entryForm.tenderReference) {
      setEntryError("DD Number, DD Date, Amount, Payee Name, Firm Bank Account and Tender Reference are required.");
      return;
    }
    setSubmitting(true);
    setEntryError("");
    try {
      let createdBy = "";
      try {
        const u = JSON.parse(localStorage.getItem("oms_user") || "{}");
        createdBy = u.username || "";
      } catch {}

      const payload = {
        ...entryForm,
        amount: Number(entryForm.amount),
        issuanceCharge: entryForm.issuanceCharge ? Number(entryForm.issuanceCharge) : 0,
        seller: entryForm.seller || null,
        createdBy,
      };

      const res = editingEntry
        ? await fetch(`/api/dd-entries/${editingEntry._id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/dd-entries", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      closeEntryModal();
      load();
    } catch (err: any) {
      setEntryError(err.message || "Failed to save");
    } finally {
      setSubmitting(false);
    }
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
            <button
              onClick={openCreateEntry}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-2.5 px-4 text-[11px] font-black uppercase tracking-wide transition-colors"
            >
              + New DD Entry
            </button>
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
                      <th className="py-2.5 px-3">Institute</th>
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
                        <td className="py-2.5 px-3 text-slate-600">{e.seller?.instituteName || "—"}</td>
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
                            <button onClick={() => openEditEntry(e)} title="Edit DD entry" className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200">
                              <FiEdit3 size={12} />
                            </button>
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

      {(modal.kind === "sent" || modal.kind === "pending_return" || modal.kind === "returned_cancelled") && modal.entry && (
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

      {modal.kind === "entry" && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={closeEntryModal}>
          <div className="bg-white rounded-2xl shadow-2xl p-5 w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-900">
                {editingEntry ? `Edit DD #${editingEntry.ddNumber}` : "New DD Entry"}
              </h3>
              <button onClick={closeEntryModal} className="text-slate-400 hover:text-slate-700"><FiX size={18} /></button>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4">
              <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-2">Upload DD (PDF)</label>
              <div className="flex items-center gap-3 flex-wrap">
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleScan(e.target.files[0])}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={scanning}
                  className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl py-2.5 px-4 text-[11px] font-black uppercase tracking-wide transition-colors"
                >
                  {scanning ? <FiLoader className="animate-spin" size={14} /> : <FiUpload size={14} />}
                  {scanning ? "Uploading..." : "Upload DD Scan"}
                </button>
                {(previewUrl || entryForm.scannedDocumentUrl) && (
                  previewUrl ? (
                    <a href={previewUrl} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-blue-600 hover:underline flex items-center gap-1">
                      <FiCheckCircle size={12} /> View uploaded PDF
                    </a>
                  ) : (
                    <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1"><FiCheckCircle size={12} /> PDF attached</span>
                  )
                )}
              </div>
              {scanError && <p className="mt-2 text-[11px] font-bold text-red-600">{scanError}</p>}
            </div>

            {entryError && <p className="text-xs font-bold text-red-600 mb-3">{entryError}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="DD Number *">
                <input value={entryForm.ddNumber} onChange={(e) => setEntryForm({ ...entryForm, ddNumber: e.target.value })} className={inputCls} />
              </Field>
              <Field label="DD Date *">
                <input type="date" value={entryForm.ddDate} onChange={(e) => setEntryForm({ ...entryForm, ddDate: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Amount *">
                <input type="number" value={entryForm.amount} onChange={(e) => setEntryForm({ ...entryForm, amount: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Payee Name *">
                <input value={entryForm.payeeName} onChange={(e) => setEntryForm({ ...entryForm, payeeName: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Institute (Seller)">
                <select value={entryForm.seller} onChange={(e) => setEntryForm({ ...entryForm, seller: e.target.value })} className={inputCls}>
                  <option value="">Select institute</option>
                  {sellers.map((s) => (
                    <option key={s._id} value={s._id}>{s.instituteName}</option>
                  ))}
                </select>
              </Field>
              <Field label="Firm Bank Account *">
                <select value={entryForm.firmBankAccount} onChange={(e) => setEntryForm({ ...entryForm, firmBankAccount: e.target.value })} className={inputCls}>
                  <option value="">Select firm bank account</option>
                  {accounts.map((a) => (
                    <option key={a._id} value={a._id}>{a.firmCode} — {a.bankName} ({a.accountNumber.slice(-4)})</option>
                  ))}
                </select>
                {accounts.length === 0 && (
                  <p className="mt-1.5 text-[10px] font-bold text-amber-700">
                    No firm bank accounts set up yet —{" "}
                    <Link href="/dashboard/account/dd-tracking/firm-bank-accounts" className="underline hover:text-amber-900">
                      add one here first
                    </Link>
                    .
                  </p>
                )}
              </Field>
              <Field label="Purpose">
                <select value={entryForm.purpose} onChange={(e) => setEntryForm({ ...entryForm, purpose: e.target.value })} className={inputCls}>
                  <option value="EMD">EMD</option>
                  <option value="Security Deposit">Security Deposit</option>
                  <option value="Other">Other</option>
                </select>
              </Field>
              <Field label="Tender Reference (Bid No.) *">
                <input value={entryForm.tenderReference} onChange={(e) => setEntryForm({ ...entryForm, tenderReference: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Issuance Charge (bank fee)">
                <input type="number" value={entryForm.issuanceCharge} onChange={(e) => setEntryForm({ ...entryForm, issuanceCharge: e.target.value })} className={inputCls} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Notes">
                  <textarea value={entryForm.notes} onChange={(e) => setEntryForm({ ...entryForm, notes: e.target.value })} className={`${inputCls} h-20`} />
                </Field>
              </div>
            </div>

            <button
              onClick={submitEntry}
              disabled={submitting}
              className="mt-5 flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl py-2.5 px-5 text-[11px] font-black uppercase tracking-wide transition-colors"
            >
              <FiSave size={14} /> {submitting ? "Saving..." : editingEntry ? "Save Changes" : "Save DD Entry"}
            </button>
          </div>
        </div>
      )}
    </BlockGuard>
  );
}

const filterCls = "bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-[11px] font-bold text-slate-700 focus:outline-none focus:border-blue-500";
const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs font-bold text-slate-700 focus:outline-none focus:border-blue-500";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-1">{label}</label>
      {children}
    </div>
  );
}
