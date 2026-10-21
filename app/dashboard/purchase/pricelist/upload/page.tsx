"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { FiUploadCloud, FiCheckCircle, FiAlertTriangle, FiDownload } from "react-icons/fi";
import { applyDiscount } from "@/lib/pricelist/applyDiscount";
import ManualItemForm from "@/components/purchase/pricelist/ManualItemForm";
import PricelistShell from "@/components/purchase/pricelist/PricelistShell";

const inr = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");

function UploadBody({ user }: { user: { username: string; isAdmin: boolean } }) {
  const [report, setReport] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [discount, setDiscount] = useState("");
  const [overwriteDisc, setOverwriteDisc] = useState(false);
  const discNum = discount.trim() === "" ? null : Number(discount);
  const discountInvalid = discNum !== null && !(discNum >= 0 && discNum <= 100);
  const previewRows: any[] = report?.preview
    ? discNum !== null && !discountInvalid
      ? applyDiscount(report.preview, discNum, overwriteDisc)
      : report.preview
    : [];

  const loadHistory = useCallback(async () => {
    const res = await fetch("/api/purchase/pricelist/history");
    const data = await res.json();
    setHistory(data.pricelists || []);
  }, []);
  useEffect(() => {
    loadHistory().catch(() => {});
  }, [loadHistory]);

  if (!user.isAdmin) {
    return <div className="p-8 text-center text-sm font-bold text-slate-500">Only admins can upload pricelists.</div>;
  }

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setMsg("");
    setReport(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("userName", user.username);
      const res = await fetch("/api/purchase/pricelist/validate", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Validation failed");
      setReport(data);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/purchase/pricelist/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: report.token, userName: user.username, discount_pct: discount, overwrite_discount: overwriteDisc }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setMsg(`Saved ${data.rowCount} rows${discNum !== null ? ` with ${discNum}% discount` : ""}.`);
      setDiscount("");
      setReport(null);
      loadHistory();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  const download = async (id: string) => {
    const res = await fetch(`/api/purchase/pricelist/history?download=${id}`);
    const data = await res.json();
    if (data.url) window.open(data.url, "_blank");
  };

  const hasBlocking = report && (report.headerErrors?.length > 0 || report.errors?.length > 0);

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          upload(e.dataTransfer.files?.[0]);
        }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
          drag ? "border-orange-500 bg-orange-50" : "border-slate-300 bg-white hover:border-orange-400"
        }`}
      >
        <FiUploadCloud className="mx-auto text-3xl text-slate-400 mb-2" />
        <div className="text-sm font-bold text-slate-700">{busy ? "Working…" : "Drop DEV Standard Pricelist (v3) .xlsx here, or click to browse"}</div>
        <input ref={inputRef} type="file" accept=".xlsx" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
      </div>

      {msg && <div className="text-sm font-bold text-slate-700 bg-slate-100 rounded-lg px-4 py-2">{msg}</div>}

      {report && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm font-black text-slate-800">{report.fileName}</div>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-1 text-xs font-bold text-slate-600">
                Discount %
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  placeholder="e.g. 10"
                  className="w-20 border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </label>
              <label className="flex items-center gap-1 text-[11px] text-slate-500" title="Off: rows that already have a discount in the file keep it">
                <input type="checkbox" checked={overwriteDisc} onChange={(e) => setOverwriteDisc(e.target.checked)} />
                Overwrite file discounts
              </label>
              <button
                disabled={busy || hasBlocking || !report.canCommit || discountInvalid}
                onClick={commit}
                className="px-5 py-2 rounded-lg bg-orange-500 text-white text-xs font-black uppercase tracking-wider disabled:opacity-40"
              >
                Confirm &amp; Save
              </button>
            </div>
          </div>

          {report.headerErrors?.length > 0 && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">
              <div className="font-black mb-1">Header problems</div>
              {report.headerErrors.map((h: string, i: number) => <div key={i}>• {h}</div>)}
            </div>
          )}
          {report.errors?.length > 0 && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700 max-h-60 overflow-auto">
              <div className="font-black mb-1">{report.errors.length} error(s) - fix and re-upload</div>
              {report.errors.slice(0, 200).map((e: any, i: number) => (
                <div key={i}>• {e.row ? `Row ${e.row}` : "File"}{e.column ? ` · ${e.column}` : ""}: {e.message}</div>
              ))}
            </div>
          )}
          {report.warnings?.length > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 max-h-40 overflow-auto">
              <div className="font-black mb-1 flex items-center gap-1"><FiAlertTriangle /> Warnings</div>
              {report.warnings.slice(0, 50).map((e: any, i: number) => (
                <div key={i}>• {e.row ? `Row ${e.row} · ` : ""}{e.column}: {e.message}</div>
              ))}
              {report.warnings.length > 50 && <div>…and {report.warnings.length - 50} more</div>}
            </div>
          )}

          {report.summary && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  ["Total rows", report.summary.total],
                  ["Priced", report.summary.priced],
                  ["On request", report.summary.onRequest],
                  ["Brands", report.summary.brands],
                  ["Categories", report.summary.categories],
                ].map(([l, v]) => (
                  <div key={l as string} className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{l}</div>
                    <div className="text-xl font-black text-slate-800">{v}</div>
                  </div>
                ))}
              </div>

              <div>
                <div className="text-xs font-black uppercase tracking-wider text-slate-600 mb-2">
                  Changes vs current version ({report.supplierCode}) — {report.diff.added} new · {report.diff.changed.length} price changed · {report.diff.removed.length} removed · {report.diff.unchanged} unchanged
                </div>
                {report.diff.changed.length > 0 && (
                  <div className="overflow-auto max-h-64 border border-slate-200 rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-500 sticky top-0">
                        <tr><th className="text-left p-2">SKU</th><th className="text-left p-2">Item</th><th className="text-right p-2">Old</th><th className="text-right p-2">New</th><th className="text-right p-2">%</th></tr>
                      </thead>
                      <tbody>
                        {report.diff.changed.map((c: any) => (
                          <tr key={c.sku_key} className="border-t border-slate-100">
                            <td className="p-2 text-slate-400">{c.sku_key}</td>
                            <td className="p-2">{c.label}</td>
                            <td className="p-2 text-right">{inr(c.old)}</td>
                            <td className="p-2 text-right font-bold">{inr(c.new)}</td>
                            <td className={`p-2 text-right font-bold ${c.pct === null ? "" : c.pct > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                              {c.pct === null ? "—" : `${c.pct > 0 ? "↑" : "↓"} ${Math.abs(c.pct)}%`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {report.diff.removed.length > 0 && (
                  <details className="mt-2 text-xs text-slate-600">
                    <summary className="cursor-pointer font-bold">{report.diff.removed.length} removed items (will become inactive)</summary>
                    <div className="max-h-40 overflow-auto mt-1">{report.diff.removed.map((r: any) => <div key={r.sku_key}>{r.sku_key} — {r.label}</div>)}</div>
                  </details>
                )}
              </div>

              <div>
                <div className="text-xs font-black uppercase tracking-wider text-slate-600 mb-2">Preview (first 50 rows)</div>
                <div className="overflow-auto max-h-80 border border-slate-200 rounded-lg">
                  <table className="w-full text-xs whitespace-nowrap">
                    <thead className="bg-slate-50 text-slate-500 sticky top-0">
                      <tr><th className="text-left p-2">SKU</th><th className="text-left p-2">Item</th><th className="p-2">Unit</th><th className="text-right p-2">Price</th><th className="text-right p-2">Disc %</th><th className="text-right p-2">GST %</th><th className="text-right p-2">Incl. GST</th><th className="p-2">Brand</th></tr>
                    </thead>
                    <tbody>
                      {previewRows.map((r: any) => (
                        <tr key={r.sku_key} className="border-t border-slate-100">
                          <td className="p-2 text-slate-400">{r.sku_key}</td>
                          <td className="p-2">{[r.category, r.sub_type, r.model_no, r.size_spec, r.variant].filter(Boolean).join(" · ")}</td>
                          <td className="p-2 text-center">{r.unit}</td>
                          <td className="p-2 text-right">{r.price_status === "ON_REQUEST" ? "On request" : inr(r.price)}</td>
                          <td className="p-2 text-right">{r.discount_pct}</td>
                          <td className="p-2 text-right">{r.gst_pct ?? "—"}</td>
                          <td className="p-2 text-right font-bold">{inr(r.unit_price_incl_gst)}</td>
                          <td className="p-2 text-center">{r.brand}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <ManualItemForm userName={user.username} onAdded={() => {}} />

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="text-xs font-black uppercase tracking-wider text-slate-600 mb-3">Upload history</div>
        <div className="overflow-auto">
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="text-slate-500">
              <tr><th className="text-left p-2">Supplier</th><th className="text-left p-2">Brand</th><th className="text-left p-2">Valid from</th><th className="text-right p-2">Rows</th><th className="text-left p-2">Uploaded by</th><th className="text-left p-2">Date</th><th className="p-2">Status</th><th /></tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h._id} className="border-t border-slate-100">
                  <td className="p-2 font-bold">{h.supplier_name}</td>
                  <td className="p-2">{h.brand}</td>
                  <td className="p-2">{h.valid_from ? new Date(h.valid_from).toLocaleDateString("en-IN") : "—"}</td>
                  <td className="p-2 text-right">{h.row_count}</td>
                  <td className="p-2">{h.uploaded_by}</td>
                  <td className="p-2">{h.uploaded_at ? new Date(h.uploaded_at).toLocaleString("en-IN") : "—"}</td>
                  <td className="p-2 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${h.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {h.status === "ACTIVE" && <FiCheckCircle className="inline mr-1" />}{h.status}
                    </span>
                  </td>
                  <td className="p-2"><button onClick={() => download(h._id)} className="text-blue-600 hover:underline flex items-center gap-1"><FiDownload /> Original</button></td>
                </tr>
              ))}
              {history.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-slate-400">No uploads yet</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function PricelistUploadPage() {
  return <PricelistShell active="upload">{(user) => <UploadBody user={user} />}</PricelistShell>;
}
