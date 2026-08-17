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
}

interface DownloadResult {
  partCount: number;
  downloads: { fileName: string; url: string }[];
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
  const [atcResult, setAtcResult] = useState<DownloadResult | null>(null);

  useEffect(() => {
    fetch("/api/companies")
      .then((res) => res.json())
      .then((data) => setCompanies(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load firms", err));
    fetch("/api/gem-bids?light=1")
      .then((res) => res.json())
      .then((data) => setBids(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load bids", err));
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
      if (kind === "custom") setNewFieldName("");
    } catch (err: any) {
      alert(err.message || "Upload failed");
    } finally {
      setUploading(false);
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
    const q = bidQuery.trim().toLowerCase();
    const list = q ? bids.filter((b) => (b.bidNo || "").toLowerCase().includes(q)) : bids;
    return list.slice(0, 25);
  }, [bids, bidQuery]);

  const runAtc = async () => {
    if (!firmId || !selectedBidId) return;
    setGeneratingAtc(true);
    setAtcResult(null);
    try {
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
                  />
                  <FixedSlot
                    label="Sign (PNG, transparent)"
                    hasFile={!!vault?.signKey}
                    disabled={uploading}
                    inputRef={signFileRef}
                    accept="image/png"
                    onPick={(f) => uploadToVault("sign", f)}
                    onDelete={() => deleteFromVault("sign")}
                  />
                  <FixedSlot
                    label="Stamp (PNG, transparent)"
                    hasFile={!!vault?.stampKey}
                    disabled={uploading}
                    inputRef={stampFileRef}
                    accept="image/png"
                    onPick={(f) => uploadToVault("stamp", f)}
                    onDelete={() => deleteFromVault("stamp")}
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
                      placeholder="Field name (e.g. PAN Card)"
                      value={newFieldName}
                      onChange={(e) => setNewFieldName(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs focus:outline-none focus:border-blue-500 w-52"
                    />
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
                        <button
                          onClick={() => deleteFromVault("custom", d.name)}
                          className="p-2 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition-colors"
                          title="Delete"
                        >
                          <FiTrash2 size={13} />
                        </button>
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
                    Fetches the bid's details and fills them onto this firm's letterhead as the cover page.
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
                  <button
                    disabled={generatingAtc || !selectedBidId}
                    onClick={runAtc}
                    className="w-fit flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white font-black uppercase text-[10px] tracking-wide py-2.5 px-4 rounded-lg transition-colors"
                  >
                    <FiUploadCloud size={13} /> {generatingAtc ? "Generating..." : "Generate ATC"}
                  </button>
                  {atcResult && (
                    <div className="bg-purple-50 border border-purple-200 rounded-xl p-3">
                      <p className="text-[10px] font-black uppercase text-purple-700 mb-1.5">
                        {atcResult.partCount > 1 ? `Split into ${atcResult.partCount} parts` : "Ready"}
                      </p>
                      {atcResult.downloads.map((d) => (
                        <a key={d.fileName} href={d.url} target="_blank" rel="noreferrer" className="block text-[11px] text-purple-800 underline">
                          {d.fileName}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
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
}: {
  label: string;
  hasFile: boolean;
  disabled: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  accept: string;
  onPick: (file: File) => void;
  onDelete: () => void;
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
