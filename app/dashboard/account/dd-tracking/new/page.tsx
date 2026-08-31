"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FiArrowLeft, FiUpload, FiCheckCircle, FiSave, FiLoader } from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";

interface FirmBankAccount {
  _id: string;
  firmCode: string;
  bankName: string;
  accountNumber: string;
}

export default function NewDDEntryPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [accounts, setAccounts] = useState<FirmBankAccount[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    ddNumber: "",
    ddDate: "",
    amount: "",
    payeeName: "",
    firmBankAccount: "",
    tenderReference: "",
    purpose: "EMD",
    issuanceCharge: "",
    notes: "",
    scannedDocumentUrl: "",
  });

  useEffect(() => {
    fetch("/api/firm-bank-accounts").then((r) => r.json()).then((d) => setAccounts(Array.isArray(d) ? d : []));
  }, []);

  const handleScan = async (file: File) => {
    setScanning(true);
    setScanNote(null);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/dd-entries/scan", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");

      setForm((f) => ({
        ...f,
        scannedDocumentUrl: data.scannedDocumentUrl,
        ddNumber: data.extracted?.ddNumber || f.ddNumber,
        amount: data.extracted?.amount != null ? String(data.extracted.amount) : f.amount,
        ddDate: data.extracted?.ddDate || f.ddDate,
        payeeName: data.extracted?.payeeName || f.payeeName,
      }));
      setPreviewUrl(data.previewUrl || null);
      if (data.ocrError) {
        setScanNote(`Document uploaded, but OCR couldn't read it (${data.ocrError}). Fill the fields manually below.`);
      } else {
        setScanNote("Fields pre-filled from the scan — please review before saving.");
      }
    } catch (err: any) {
      setError(err.message || "Scan upload failed");
    } finally {
      setScanning(false);
    }
  };

  const submit = async () => {
    if (!form.ddNumber || !form.ddDate || !form.amount || !form.payeeName || !form.firmBankAccount || !form.tenderReference) {
      setError("DD Number, DD Date, Amount, Payee Name, Firm Bank Account and Tender Reference are required.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      let createdBy = "";
      try {
        const u = JSON.parse(localStorage.getItem("oms_user") || "{}");
        createdBy = u.username || "";
      } catch {}

      const res = await fetch("/api/dd-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          amount: Number(form.amount),
          issuanceCharge: form.issuanceCharge ? Number(form.issuanceCharge) : 0,
          createdBy,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      router.push("/dashboard/account/dd-tracking/ledger");
    } catch (err: any) {
      setError(err.message || "Failed to save");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <BlockGuard permission="accountStatements">
      <div className="p-4 md:p-8 bg-slate-50 min-h-screen">
        <div className="max-w-3xl mx-auto flex flex-col gap-6">
          <div>
            <Link href="/dashboard/account/dd-tracking" className="flex items-center gap-2 text-slate-500 hover:text-blue-600 text-xs mb-2 transition-colors w-fit">
              <FiArrowLeft /> Back to DD Tracking
            </Link>
            <h1 className="text-xl font-black uppercase tracking-tight text-slate-900">New DD Entry</h1>
            <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mt-0.5">Scan the DD to auto-fill, or enter manually</p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
            <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-2">Scan Document (optional)</label>
            <div className="flex items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleScan(e.target.files[0])}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={scanning}
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl py-2.5 px-4 text-[11px] font-black uppercase tracking-wide transition-colors"
              >
                {scanning ? <FiLoader className="animate-spin" size={14} /> : <FiUpload size={14} />}
                {scanning ? "Scanning..." : "Upload DD Scan"}
              </button>
              {previewUrl && (
                <a href={previewUrl} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-blue-600 hover:underline">
                  View uploaded scan
                </a>
              )}
            </div>
            {scanNote && (
              <p className="mt-2 text-[11px] font-bold text-amber-700 flex items-center gap-1.5">
                <FiCheckCircle size={12} /> {scanNote}
              </p>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
            {error && <p className="text-xs font-bold text-red-600 mb-3">{error}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="DD Number *">
                <input value={form.ddNumber} onChange={(e) => setForm({ ...form, ddNumber: e.target.value })} className={inputCls} />
              </Field>
              <Field label="DD Date *">
                <input type="date" value={form.ddDate} onChange={(e) => setForm({ ...form, ddDate: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Amount *">
                <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Payee Name *">
                <input value={form.payeeName} onChange={(e) => setForm({ ...form, payeeName: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Firm Bank Account *">
                <select value={form.firmBankAccount} onChange={(e) => setForm({ ...form, firmBankAccount: e.target.value })} className={inputCls}>
                  <option value="">Select firm bank account</option>
                  {accounts.map((a) => (
                    <option key={a._id} value={a._id}>{a.firmCode} — {a.bankName} ({a.accountNumber.slice(-4)})</option>
                  ))}
                </select>
              </Field>
              <Field label="Purpose">
                <select value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} className={inputCls}>
                  <option value="EMD">EMD</option>
                  <option value="Security Deposit">Security Deposit</option>
                  <option value="Other">Other</option>
                </select>
              </Field>
              <Field label="Tender Reference (Bid No.) *">
                <input value={form.tenderReference} onChange={(e) => setForm({ ...form, tenderReference: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Issuance Charge (bank fee)">
                <input type="number" value={form.issuanceCharge} onChange={(e) => setForm({ ...form, issuanceCharge: e.target.value })} className={inputCls} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Notes">
                  <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={`${inputCls} h-20`} />
                </Field>
              </div>
            </div>

            <button
              onClick={submit}
              disabled={submitting}
              className="mt-5 flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl py-2.5 px-5 text-[11px] font-black uppercase tracking-wide transition-colors"
            >
              <FiSave size={14} /> {submitting ? "Saving..." : "Save DD Entry"}
            </button>
          </div>
        </div>
      </div>
    </BlockGuard>
  );
}

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs font-bold text-slate-700 focus:outline-none focus:border-blue-500";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-1">{label}</label>
      {children}
    </div>
  );
}
