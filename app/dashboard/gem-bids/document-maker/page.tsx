"use client";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import {
  FiArrowLeft,
  FiFileText,
  FiUploadCloud,
  FiTrash2,
  FiCheckSquare,
  FiDownload,
  FiPlus,
  FiLayers,
  FiEye,
} from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";

interface Company {
  _id: string;
  firmName: string;
  firmCode: string;
}

interface VaultDocument {
  name: string;
  r2Key: string;
  originalFileName: string;
  uploadedAt: string;
}

interface Vault {
  _id: string;
  firmId: string;
  documents: VaultDocument[];
  letterheadKey: string | null;
  signKey: string | null;
  stampKey: string | null;
}

interface GemBid {
  _id: string;
  bidNo: string;
  items?: string;
  currentSection?: string;
}

// ATC is only ever generated for a bid that's actually being worked -
// restricting the picker to these two sections (rather than every bid ever
// scraped) is both a usability filter and a guardrail against generating
// an acceptance letter for a bid nobody's decided to pursue yet.
const ATC_ELIGIBLE_SECTIONS = new Set(["bids_to_fill", "submitted_bids"]);

interface DownloadResult {
  partCount: number;
  downloads: { fileName: string; url: string }[];
  mode?: "image" | "text_fallback";
  note?: string;
}

interface DocFetchStatus {
  status: "idle" | "pending" | "fetching" | "done" | "failed";
  error?: string | null;
}

interface BundleResult {
  url: string;
  fileName: string;
  atcMode: "image" | "text_fallback";
  notes: string[];
}

interface BoqItem {
  itemNumber: string;
  itemTitle: string;
  itemDescription: string;
  quantity: string;
  unit: string;
  consigneeId: string;
  deliveryPeriod: string;
  rate: string;
  suggestedRate: string;
  suggestedFromBidNo: string;
}

type Tab = "vault" | "generate";

export default function DocumentMakerPage() {
  const [tab, setTab] = useState<Tab>("vault");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [firmId, setFirmId] = useState("");
  const [vault, setVault] = useState<Vault | null>(null);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [newFieldName, setNewFieldName] = useState("");
  // Shared with the GeM Bids Edit Bid modal's "Document required from
  // seller" multi-select (see /api/gem-bids/document-types) - so a document
  // name typed here is available to pick from there, and vice versa.
  const [documentTypes, setDocumentTypes] = useState<string[]>([]);
  const customFileRef = useRef<HTMLInputElement>(null);
  const letterheadFileRef = useRef<HTMLInputElement>(null);
  const signFileRef = useRef<HTMLInputElement>(null);
  const stampFileRef = useRef<HTMLInputElement>(null);

  const [selectedDocNames, setSelectedDocNames] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [mergeResult, setMergeResult] = useState<DownloadResult | null>(null);

  const [bids, setBids] = useState<GemBid[]>([]);
  const [bidQuery, setBidQuery] = useState("");
  const [selectedBidId, setSelectedBidId] = useState("");
  const [generatingAtc, setGeneratingAtc] = useState(false);
  const [atcPhase, setAtcPhase] = useState<"idle" | "fetching" | "generating">("idle");
  const [atcResult, setAtcResult] = useState<DownloadResult | null>(null);

  // The real multi-page ATC + Bid Document are fetched by the GeM Bid
  // Exporter extension (GeM blocks non-browser requests - see
  // /api/gem-bids/cities's note), not this page directly - Generate ATC
  // below queues this itself and waits for it, no separate button needed.
  const [docFetchStatus, setDocFetchStatus] = useState<DocFetchStatus | null>(null);
  const [hasBidDocument, setHasBidDocument] = useState(false);
  const [hasAtcDocument, setHasAtcDocument] = useState(false);
  const [hasBoqDocument, setHasBoqDocument] = useState(false);

  const [bundling, setBundling] = useState(false);
  const [bundleResult, setBundleResult] = useState<BundleResult | null>(null);

  const [boqModalOpen, setBoqModalOpen] = useState(false);
  const [loadingBoq, setLoadingBoq] = useState(false);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [savingBoq, setSavingBoq] = useState(false);
  const [boqExportUrl, setBoqExportUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/companies")
      .then((res) => res.json())
      .then((data) => setCompanies(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load firms", err));
    fetch("/api/gem-bids?light=1")
      .then((res) => res.json())
      .then((data) => setBids(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load bids", err));
    fetch("/api/gem-bids/document-types")
      .then((res) => res.json())
      .then((data) => setDocumentTypes(Array.isArray(data?.documentTypes) ? data.documentTypes : []))
      .catch((err) => console.error("Failed to load document types", err));
  }, []);

  const fetchVault = useCallback((id: string) => {
    if (!id) {
      setVault(null);
      return;
    }
    setVaultLoading(true);
    fetch(`/api/document-vault/${id}`)
      .then((res) => res.json())
      .then((data) => setVault(data))
      .catch((err) => console.error("Failed to load vault", err))
      .finally(() => setVaultLoading(false));
  }, []);

  useEffect(() => {
    fetchVault(firmId);
    setSelectedDocNames(new Set());
    setMergeResult(null);
    setAtcResult(null);
  }, [firmId, fetchVault]);

  const uploadToVault = async (kind: "custom" | "letterhead" | "sign" | "stamp", file: File, fieldName?: string) => {
    if (!firmId) return;
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("file", file);
    if (fieldName) fd.append("fieldName", fieldName);

    setUploading(true);
    try {
      const res = await fetch(`/api/document-vault/${firmId}`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Upload failed");
      setVault(data);
      if (kind === "custom") {
        setNewFieldName("");
        // Best-effort: keep the shared document-type list (also used by GeM
        // Bids' Edit Bid modal) in sync with whatever gets typed here.
        if (fieldName && !documentTypes.some((t) => t.toLowerCase() === fieldName.toLowerCase())) {
          fetch("/api/gem-bids/document-types", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ add: fieldName }),
          })
            .then((r) => r.json())
            .then((d) => {
              if (Array.isArray(d?.documentTypes)) setDocumentTypes(d.documentTypes);
            })
            .catch((err) => console.error("Failed to save new document type", err));
        }
      }
    } catch (err: any) {
      alert(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const previewFromVault = async (kind: "custom" | "letterhead" | "sign" | "stamp", name?: string) => {
    if (!firmId) return;
    const params = new URLSearchParams({ kind });
    if (name) params.set("name", name);
    try {
      const res = await fetch(`/api/document-vault/${firmId}/preview?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Preview failed");
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      alert(err.message || "Preview failed");
    }
  };

  const deleteFromVault = async (kind: "custom" | "letterhead" | "sign" | "stamp", name?: string) => {
    if (!firmId) return;
    if (!confirm("Delete this?")) return;
    const params = new URLSearchParams({ kind });
    if (name) params.set("name", name);
    try {
      const res = await fetch(`/api/document-vault/${firmId}?${params.toString()}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Delete failed");
      setVault(data);
    } catch (err: any) {
      alert(err.message || "Delete failed");
    }
  };

  const toggleDoc = (name: string) => {
    setSelectedDocNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleSelectAllDocs = () => {
    if (!vault) return;
    setSelectedDocNames((prev) =>
      prev.size === vault.documents.length ? new Set() : new Set(vault.documents.map((d) => d.name))
    );
  };

  const runMerge = async () => {
    if (!firmId || selectedDocNames.size === 0) return;
    setMerging(true);
    setMergeResult(null);
    try {
      const res = await fetch("/api/document-maker/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firmId, documentNames: Array.from(selectedDocNames) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to generate");
      setMergeResult(data);
    } catch (err: any) {
      alert(err.message || "Failed to generate");
    } finally {
      setMerging(false);
    }
  };

  const filteredBids = useMemo(() => {
    const eligible = bids.filter((b) => ATC_ELIGIBLE_SECTIONS.has(b.currentSection || ""));
    const q = bidQuery.trim().toLowerCase();
    const list = q ? eligible.filter((b) => (b.bidNo || "").toLowerCase().includes(q)) : eligible;
    return list.slice(0, 25);
  }, [bids, bidQuery]);

  const runAtc = async () => {
    if (!firmId || !selectedBidId) return;
    setGeneratingAtc(true);
    setAtcResult(null);
    try {
      // Auto-fetch the bid's real ATC Link + Bid Document first if that
      // hasn't happened yet - no separate "Fetch Bid Documents" click
      // needed. Skipped straight past if either is already cached (or a
      // fetch was already attempted for this bid before), and quietly
      // continues even if the fetch comes back empty (blank on many bids -
      // buildAtcDocument falls back to a text summary cover in that case).
      let status = docFetchStatus?.status || "idle";
      if (status === "idle" && !hasBidDocument && !hasAtcDocument) {
        setAtcPhase("fetching");
        const queueRes = await fetch("/api/gem-bids/fetch-documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bidId: selectedBidId }),
        });
        if (!queueRes.ok) throw new Error("Failed to queue document fetch");
        status = "pending";
        setDocFetchStatus({ status: "pending" });

        // Polled locally (not the passive background poll below) since ATC
        // generation genuinely needs to wait for this - the extension's
        // background worker checks about once a minute, so this can take a
        // little while; capped so a stuck/offline extension doesn't hang
        // the button forever.
        const deadline = Date.now() + 3 * 60 * 1000;
        while ((status === "pending" || status === "fetching") && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 4000));
          const statusRes = await fetch(`/api/gem-bids/fetch-documents/status?bidId=${selectedBidId}`);
          const statusData = await statusRes.json();
          if (statusData?.error) break;
          status = statusData.docFetch?.status || "idle";
          setDocFetchStatus(statusData.docFetch || { status: "idle" });
          setHasBidDocument(!!statusData.hasBidDocument);
          setHasAtcDocument(!!statusData.hasAtcDocument);
        }
      }

      setAtcPhase("generating");
      const res = await fetch("/api/document-maker/atc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firmId, bidId: selectedBidId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to generate ATC");
      setAtcResult(data);
    } catch (err: any) {
      alert(err.message || "Failed to generate ATC");
    } finally {
      setGeneratingAtc(false);
      setAtcPhase("idle");
    }
  };

  const fetchDocStatus = useCallback(() => {
    if (!selectedBidId) return;
    fetch(`/api/gem-bids/fetch-documents/status?bidId=${selectedBidId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.error) return;
        setDocFetchStatus(data.docFetch || { status: "idle" });
        setHasBidDocument(!!data.hasBidDocument);
        setHasAtcDocument(!!data.hasAtcDocument);
        setHasBoqDocument(!!data.hasBoqDocument);
      })
      .catch((err) => console.error("Failed to load document-fetch status", err));
  }, [selectedBidId]);

  useEffect(() => {
    setDocFetchStatus(null);
    setHasBidDocument(false);
    setHasAtcDocument(false);
    setHasBoqDocument(false);
    setAtcResult(null);
    setBundleResult(null);
    setBoqModalOpen(false);
    setBoqItems([]);
    setBoqExportUrl(null);
    fetchDocStatus();
  }, [selectedBidId, fetchDocStatus]);

  const openBoqRates = async () => {
    if (!selectedBidId) return;
    setLoadingBoq(true);
    setBoqExportUrl(null);
    try {
      const res = await fetch(`/api/gem-bids/boq?bidId=${selectedBidId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load BOQ");
      setBoqItems(data.items || []);
      setBoqModalOpen(true);
    } catch (err: any) {
      alert(err.message || "Failed to load BOQ");
    } finally {
      setLoadingBoq(false);
    }
  };

  const updateBoqRate = (itemNumber: string, rate: string) => {
    setBoqItems((prev) => prev.map((it) => (it.itemNumber === itemNumber ? { ...it, rate } : it)));
  };

  const saveBoqRates = async () => {
    if (!selectedBidId) return;
    setSavingBoq(true);
    try {
      const res = await fetch("/api/gem-bids/boq/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bidId: selectedBidId,
          items: boqItems.map((it) => ({ itemNumber: it.itemNumber, itemTitle: it.itemTitle, rate: it.rate })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to save BOQ rates");
      alert(`Saved ${data.savedCount} rate(s).`);
    } catch (err: any) {
      alert(err.message || "Failed to save BOQ rates");
    } finally {
      setSavingBoq(false);
    }
  };

  const exportBoq = async () => {
    if (!selectedBidId) return;
    try {
      const res = await fetch(`/api/gem-bids/boq/export?bidId=${selectedBidId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to export BOQ");
      setBoqExportUrl(data.url);
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      alert(err.message || "Failed to export BOQ");
    }
  };

  const runBundle = async () => {
    if (!firmId || !selectedBidId) return;
    setBundling(true);
    setBundleResult(null);
    try {
      const res = await fetch("/api/document-maker/bundle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firmId, bidId: selectedBidId, documentNames: Array.from(selectedDocNames) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to build ZIP bundle");
      setBundleResult(data);
    } catch (err: any) {
      alert(err.message || "Failed to build ZIP bundle");
    } finally {
      setBundling(false);
    }
  };

  return (
    <BlockGuard
      permission="gemBids"
      fallback={
        <div className="flex flex-col items-center gap-2 m-4 p-4 border border-red-200 rounded-xl bg-red-50 text-center">
          <p className="text-red-500 font-bold uppercase">You have no Access for this Page.</p>
          <Link href="/dashboard" className="text-sm bg-slate-900 text-white px-4 py-2 mt-4 rounded-lg hover:bg-slate-800 transition-all">
            Go to Dashboard
          </Link>
        </div>
      }
    >
      <div className="p-4 md:p-8 bg-slate-50 min-h-screen">
        <div className="max-w-6xl mx-auto flex flex-col gap-6">
          <div>
            <Link href="/dashboard/gem-bids" className="flex items-center gap-2 text-slate-500 hover:text-blue-600 text-xs mb-2 transition-colors w-fit">
              <FiArrowLeft /> Back to GeM Bids
            </Link>
            <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
              <FiFileText className="text-blue-600" /> Bid Document Maker
            </h1>
            <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mt-0.5">
              Firm Document Vault, Merge &amp; ATC Generation
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl p-1">
              {([
                { key: "vault", label: "Document Vault" },
                { key: "generate", label: "Generate" },
              ] as { key: Tab; label: string }[]).map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wide transition-colors ${
                    tab === t.key ? "bg-blue-600 text-white shadow" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <select
              value={firmId}
              onChange={(e) => setFirmId(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs text-slate-700 focus:outline-none focus:border-blue-500 font-bold min-w-[220px]"
            >
              <option value="">Select Firm...</option>
              {companies.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.firmName} {c.firmCode ? `(${c.firmCode})` : ""}
                </option>
              ))}
            </select>
          </div>

          {!firmId ? (
            <div className="text-center py-16 text-slate-400 text-xs font-bold uppercase tracking-widest">
              Select a firm to continue
            </div>
          ) : vaultLoading ? (
            <div className="flex justify-center items-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-blue-500"></div>
            </div>
          ) : tab === "vault" ? (
            <>
              {/* Fixed slots: Letterhead, Sign, Stamp */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 mb-4">Letterhead &amp; Sign/Stamp</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <FixedSlot
                    label="Letterhead (PDF)"
                    hasFile={!!vault?.letterheadKey}
                    disabled={uploading}
                    inputRef={letterheadFileRef}
                    accept="application/pdf"
                    onPick={(f) => uploadToVault("letterhead", f)}
                    onDelete={() => deleteFromVault("letterhead")}
                    onPreview={() => previewFromVault("letterhead")}
                  />
                  <FixedSlot
                    label="Sign (PNG, transparent)"
                    hasFile={!!vault?.signKey}
                    disabled={uploading}
                    inputRef={signFileRef}
                    accept="image/png"
                    onPick={(f) => uploadToVault("sign", f)}
                    onDelete={() => deleteFromVault("sign")}
                    onPreview={() => previewFromVault("sign")}
                  />
                  <FixedSlot
                    label="Stamp (PNG, transparent)"
                    hasFile={!!vault?.stampKey}
                    disabled={uploading}
                    inputRef={stampFileRef}
                    accept="image/png"
                    onPick={(f) => uploadToVault("stamp", f)}
                    onDelete={() => deleteFromVault("stamp")}
                    onPreview={() => previewFromVault("stamp")}
                  />
                </div>
              </div>

              {/* Dynamic custom documents */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex flex-wrap items-center gap-2 justify-between">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-900">
                    Documents
                    <span className="ml-2 bg-slate-100 text-slate-600 text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none">
                      {vault?.documents.length || 0}
                    </span>
                  </h3>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      list="documentTypeOptions"
                      placeholder="Field name (e.g. PAN Card)"
                      value={newFieldName}
                      onChange={(e) => setNewFieldName(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs focus:outline-none focus:border-blue-500 w-52"
                    />
                    <datalist id="documentTypeOptions">
                      {documentTypes.map((t) => (
                        <option key={t} value={t} />
                      ))}
                    </datalist>
                    <input
                      ref={customFileRef}
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f && newFieldName.trim()) uploadToVault("custom", f, newFieldName.trim());
                        else if (f) alert("Type a field name first");
                        e.target.value = "";
                      }}
                    />
                    <button
                      disabled={uploading || !newFieldName.trim()}
                      onClick={() => customFileRef.current?.click()}
                      className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-black uppercase text-[10px] tracking-wide py-2 px-3 rounded-lg transition-colors"
                    >
                      <FiPlus size={12} /> Add + Upload PDF
                    </button>
                  </div>
                </div>
                {(vault?.documents.length || 0) === 0 ? (
                  <div className="text-center py-10 text-slate-400 text-xs font-bold uppercase tracking-widest">
                    No documents uploaded yet
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {vault!.documents.map((d) => (
                      <div key={d.name} className="p-3 px-5 flex items-center justify-between">
                        <div>
                          <span className="text-xs font-bold text-slate-800">{d.name}</span>
                          <span className="block text-[10px] text-slate-400">{d.originalFileName}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => previewFromVault("custom", d.name)}
                            className="p-2 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 transition-colors"
                            title="Preview"
                          >
                            <FiEye size={13} />
                          </button>
                          <button
                            onClick={() => deleteFromVault("custom", d.name)}
                            className="p-2 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition-colors"
                            title="Delete"
                          >
                            <FiTrash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Select & Generate */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                    <FiCheckSquare className="text-blue-600" size={14} /> Select Documents &amp; Generate
                  </h3>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Selected documents are merged into one PDF, sign+stamp is overlaid bottom-right on every page, and
                    the output is auto-split if it exceeds 99 pages or 9.98MB.
                  </p>
                </div>
                {(vault?.documents.length || 0) === 0 ? (
                  <div className="text-center py-10 text-slate-400 text-xs font-bold uppercase tracking-widest">
                    Upload documents in the Vault tab first
                  </div>
                ) : (
                  <div className="p-5 flex flex-col gap-2">
                    <label className="flex items-center gap-2 text-xs font-black uppercase text-slate-500 cursor-pointer pb-2 border-b border-slate-100 mb-1">
                      <input
                        type="checkbox"
                        checked={vault!.documents.length > 0 && selectedDocNames.size === vault!.documents.length}
                        onChange={toggleSelectAllDocs}
                      />
                      Select All Documents
                    </label>
                    {vault!.documents.map((d) => (
                      <label key={d.name} className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                        <input type="checkbox" checked={selectedDocNames.has(d.name)} onChange={() => toggleDoc(d.name)} />
                        {d.name}
                      </label>
                    ))}
                    <button
                      disabled={merging || selectedDocNames.size === 0}
                      onClick={runMerge}
                      className="mt-3 w-fit flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-black uppercase text-[10px] tracking-wide py-2.5 px-4 rounded-lg transition-colors"
                    >
                      <FiDownload size={13} /> {merging ? "Generating..." : "Download / Run"}
                    </button>
                    {mergeResult && (
                      <div className="mt-2 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                        <p className="text-[10px] font-black uppercase text-emerald-700 mb-1.5">
                          {mergeResult.partCount > 1 ? `Split into ${mergeResult.partCount} parts` : "Ready"}
                        </p>
                        {mergeResult.downloads.map((d) => (
                          <a key={d.fileName} href={d.url} target="_blank" rel="noreferrer" className="block text-[11px] text-emerald-800 underline">
                            {d.fileName}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ATC Generate */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                    <FiLayers className="text-purple-600" size={14} /> ATC Generate
                  </h3>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Pastes the bid's real ATC document (every page, fetched via the GeM Bid Exporter extension) onto
                    this firm's letterhead with sign+stamp on each page. Falls back to a text summary cover page if
                    the real ATC hasn&apos;t been fetched yet (or this bid has none available on GeM).
                  </p>
                </div>
                <div className="p-5 flex flex-col gap-3">
                  <input
                    type="text"
                    placeholder="Search Bid No..."
                    value={bidQuery}
                    onChange={(e) => setBidQuery(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs focus:outline-none focus:border-blue-500 max-w-xs"
                  />
                  <select
                    value={selectedBidId}
                    onChange={(e) => setSelectedBidId(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs font-bold focus:outline-none focus:border-blue-500 max-w-md"
                  >
                    <option value="">Select Bid...</option>
                    {filteredBids.map((b) => (
                      <option key={b._id} value={b._id}>
                        {b.bidNo} {b.items ? `— ${b.items.slice(0, 40)}` : ""}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-slate-400 -mt-1">
                    Only bids in Bids to Fill or Submitted Bids are listed here.
                  </p>

                  {selectedBidId && (
                    <div className="flex flex-wrap gap-2 text-[10px] font-bold -mt-1">
                      <span className={hasBidDocument ? "text-emerald-600" : "text-slate-400"}>
                        {hasBidDocument ? "✓ Bid Document fetched" : "— Bid Document not fetched yet"}
                      </span>
                      <span className={hasAtcDocument ? "text-emerald-600" : "text-slate-400"}>
                        {hasAtcDocument ? "✓ ATC Link document fetched" : "— ATC Link document not fetched yet"}
                      </span>
                      <span className={hasBoqDocument ? "text-emerald-600" : "text-slate-400"}>
                        {hasBoqDocument ? "✓ BOQ Detail Document fetched" : "— BOQ Detail Document not fetched yet"}
                      </span>
                    </div>
                  )}

                  <button
                    disabled={generatingAtc || !selectedBidId}
                    onClick={runAtc}
                    className="w-fit flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white font-black uppercase text-[10px] tracking-wide py-2.5 px-4 rounded-lg transition-colors"
                  >
                    <FiUploadCloud size={13} />
                    {atcPhase === "fetching"
                      ? "Fetching bid documents..."
                      : atcPhase === "generating"
                      ? "Generating ATC..."
                      : "Generate ATC"}
                  </button>
                  {atcPhase === "fetching" && (
                    <p className="text-[10px] text-slate-400 -mt-2">
                      Fetching the real Bid Document + ATC link via the GeM Bid Exporter extension (checks about once
                      a minute, keep it installed with your GeM login active) — falls back to a text summary cover if
                      this bid has no ATC link available.
                    </p>
                  )}
                  {docFetchStatus?.status === "failed" && docFetchStatus.error && (
                    <p className="text-[10px] text-red-600 -mt-2">{docFetchStatus.error}</p>
                  )}
                  {atcResult && (
                    <div className="bg-purple-50 border border-purple-200 rounded-xl p-3">
                      <p className="text-[10px] font-black uppercase text-purple-700 mb-1.5">
                        {atcResult.mode === "image" ? "Image-based (real ATC document)" : "Text summary cover"}
                        {atcResult.partCount > 1 ? ` — split into ${atcResult.partCount} parts` : ""}
                      </p>
                      {atcResult.note && <p className="text-[10px] text-purple-700/80 mb-1.5">{atcResult.note}</p>}
                      {atcResult.downloads.map((d) => (
                        <a key={d.fileName} href={d.url} target="_blank" rel="noreferrer" className="block text-[11px] text-purple-800 underline">
                          {d.fileName}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* BOQ Rates */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                    <FiCheckSquare className="text-amber-600" size={14} /> BOQ Rates
                  </h3>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Fill a rate per item on this bid&apos;s BOQ Detail Document (when it has one) - saved rates are
                    remembered per bid and also saved into a shared rate directory, so a matching item on a future
                    bid shows a suggestion from what you filled before. Fetched automatically by Generate ATC above,
                    no separate fetch needed.
                  </p>
                </div>
                <div className="p-5 flex flex-col gap-2">
                  <button
                    disabled={loadingBoq || !selectedBidId || !hasBoqDocument}
                    onClick={openBoqRates}
                    className="w-fit flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white font-black uppercase text-[10px] tracking-wide py-2.5 px-4 rounded-lg transition-colors"
                  >
                    <FiCheckSquare size={13} /> {loadingBoq ? "Loading..." : "Open BOQ Rates"}
                  </button>
                  {selectedBidId && !hasBoqDocument && (
                    <p className="text-[10px] text-slate-400">
                      No BOQ fetched yet for this bid — click &quot;Generate ATC&quot; above first (it fetches this
                      too), or this bid simply has no BOQ Detail Document on GeM.
                    </p>
                  )}
                </div>
              </div>

              {/* ZIP Bundle */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                    <FiDownload className="text-emerald-600" size={14} /> ZIP Bundle
                  </h3>
                  <p className="text-[10px] text-slate-400 mt-1">
                    One ZIP with the Bid Document, the ATC Link document, each document checked above on its own, the
                    generated ATC (PDF + Word), and everything merged into one &quot;ATC_ALL_&quot; PDF (in the order
                    checked above, split at 99 pages/9.5MB into ATC_ALL_, ATC_ALL_2, ...). Uses the bid selected in
                    ATC Generate above.
                  </p>
                </div>
                <div className="p-5 flex flex-col gap-2">
                  <button
                    disabled={bundling || !selectedBidId}
                    onClick={runBundle}
                    className="w-fit flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-black uppercase text-[10px] tracking-wide py-2.5 px-4 rounded-lg transition-colors"
                  >
                    <FiDownload size={13} /> {bundling ? "Building..." : "Download ZIP Bundle"}
                  </button>
                  {bundleResult && (
                    <div className="mt-1 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                      <a href={bundleResult.url} target="_blank" rel="noreferrer" className="block text-[11px] text-emerald-800 underline font-bold">
                        {bundleResult.fileName}
                      </a>
                      {bundleResult.notes.length > 0 && (
                        <ul className="mt-1.5 list-disc list-inside">
                          {bundleResult.notes.map((n, i) => (
                            <li key={i} className="text-[10px] text-emerald-700/80">
                              {n}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {boqModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">BOQ Rates</h3>
              <button onClick={() => setBoqModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <FiArrowLeft className="rotate-180" size={16} />
              </button>
            </div>
            <div className="p-5 flex flex-col gap-3">
              {boqItems.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-8">No items found in this BOQ.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-black">
                      <tr>
                        <th className="py-2 px-2 text-left">#</th>
                        <th className="py-2 px-2 text-left">Item Title</th>
                        <th className="py-2 px-2 text-left">Qty</th>
                        <th className="py-2 px-2 text-left">Unit</th>
                        <th className="py-2 px-2 text-left">Delivery</th>
                        <th className="py-2 px-2 text-left w-36">Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {boqItems.map((it) => (
                        <tr key={it.itemNumber}>
                          <td className="py-2 px-2 text-slate-500">{it.itemNumber}</td>
                          <td className="py-2 px-2 font-bold text-slate-700 max-w-[260px]" title={it.itemDescription}>
                            {it.itemTitle}
                          </td>
                          <td className="py-2 px-2 text-slate-500 whitespace-nowrap">{it.quantity}</td>
                          <td className="py-2 px-2 text-slate-500 whitespace-nowrap">{it.unit}</td>
                          <td className="py-2 px-2 text-slate-500 whitespace-nowrap">{it.deliveryPeriod}d</td>
                          <td className="py-2 px-2">
                            <input
                              value={it.rate}
                              onChange={(e) => updateBoqRate(it.itemNumber, e.target.value)}
                              placeholder={it.suggestedRate ? `Suggested: ${it.suggestedRate}` : "Rate"}
                              className="w-full border border-slate-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-amber-400"
                            />
                            {it.suggestedRate && (
                              <button
                                type="button"
                                onClick={() => updateBoqRate(it.itemNumber, it.suggestedRate)}
                                className="text-[9px] text-amber-700 underline mt-0.5"
                                title={it.suggestedFromBidNo ? `From ${it.suggestedFromBidNo}` : undefined}
                              >
                                Use {it.suggestedRate}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="p-5 border-t border-slate-100 flex flex-wrap items-center gap-2 justify-end sticky bottom-0 bg-white">
              {boqExportUrl && (
                <a href={boqExportUrl} target="_blank" rel="noreferrer" className="text-[11px] text-emerald-700 underline font-bold mr-auto">
                  Download ready
                </a>
              )}
              <button
                onClick={exportBoq}
                disabled={boqItems.length === 0}
                className="px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wide bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 transition-colors"
              >
                Download Filled BOQ
              </button>
              <button
                onClick={saveBoqRates}
                disabled={savingBoq || boqItems.length === 0}
                className="px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wide bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white transition-colors"
              >
                {savingBoq ? "Saving..." : "Save Rates"}
              </button>
            </div>
          </div>
        </div>
      )}
    </BlockGuard>
  );
}

function FixedSlot({
  label,
  hasFile,
  disabled,
  inputRef,
  accept,
  onPick,
  onDelete,
  onPreview,
}: {
  label: string;
  hasFile: boolean;
  disabled: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  accept: string;
  onPick: (file: File) => void;
  onDelete: () => void;
  onPreview?: () => void;
}) {
  return (
    <div className="border border-slate-200 rounded-xl p-3 flex flex-col gap-2">
      <span className="text-[10px] font-black uppercase text-slate-500">{label}</span>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
      <div className="flex items-center gap-2">
        <button
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 font-black uppercase text-[10px] tracking-wide py-2 px-3 rounded-lg transition-colors"
        >
          <FiUploadCloud size={12} /> {hasFile ? "Replace" : "Upload"}
        </button>
        {hasFile && onPreview && (
          <button onClick={onPreview} className="p-2 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 transition-colors" title="Preview">
            <FiEye size={13} />
          </button>
        )}
        {hasFile && (
          <button onClick={onDelete} className="p-2 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition-colors" title="Delete">
            <FiTrash2 size={13} />
          </button>
        )}
      </div>
      <span className={`text-[9px] font-black uppercase ${hasFile ? "text-emerald-600" : "text-slate-400"}`}>
        {hasFile ? "Uploaded" : "Not uploaded"}
      </span>
    </div>
  );
}
