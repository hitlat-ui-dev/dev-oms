"use client";
import Link from "next/link";
import { useState, useEffect, useMemo } from "react";
import {
  FiArrowLeft,
  FiLink,
  FiSearch,
  FiCopy,
  FiExternalLink,
  FiCheckCircle,
  FiAlertTriangle
} from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";
import { tokenizeMatchText, scoreTokenSimilarity, formatDate } from "@/lib/gemSync/catalogueMatch";

interface FirmItemListing {
  id: string;
  firmCode: string;
  itemId: string;
  itemName: string;
  gemLink: string;
  rate: number;
  availGemStock?: number;
  minQty: number;
  status: "Synced" | "Pending";
  buyerId: string;
  date: string;
}

export default function GeMCataloguePage() {
  const [catalogueLinks, setCatalogueLinks] = useState<any[]>([]);
  const [listings, setListings] = useState<FirmItemListing[]>([]);
  const [loading, setLoading] = useState(true);

  const [catalogueSearchFirm, setCatalogueSearchFirm] = useState("");
  const [catalogueSearchName, setCatalogueSearchName] = useState("");
  const [catalogueSearchCatalogueId, setCatalogueSearchCatalogueId] = useState("");
  const [catalogueSearchBrand, setCatalogueSearchBrand] = useState("");
  const [catalogueSearchModel, setCatalogueSearchModel] = useState("");

  useEffect(() => {
    fetch("/api/gem-sync?catalogue=1")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.catalogueLinks)) setCatalogueLinks(data.catalogueLinks);
        if (Array.isArray(data.listings)) setListings(data.listings);
      })
      .catch((err) => console.error("Error fetching GeM catalogue:", err))
      .finally(() => setLoading(false));
  }, []);

  // Each field below filters independently (AND'd together), so you can e.g.
  // search one firm's "spring file" brand without matching other firms' products.
  const filteredCatalogueLinks = useMemo(() => {
    const firmQ = catalogueSearchFirm.toLowerCase().trim();
    const nameQ = catalogueSearchName.toLowerCase().trim();
    const catalogueIdQ = catalogueSearchCatalogueId.toLowerCase().trim();
    const brandQ = catalogueSearchBrand.toLowerCase().trim();
    const modelQ = catalogueSearchModel.toLowerCase().trim();

    return catalogueLinks.filter((row) => {
      if (firmQ && !(row.firmCode || "").toLowerCase().includes(firmQ)) return false;
      if (nameQ && !(row["Name"]?.text || "").toLowerCase().includes(nameQ)) return false;
      if (catalogueIdQ && !(row["Gem Catalogue Id"]?.text || "").toLowerCase().includes(catalogueIdQ)) return false;
      if (brandQ && !(row["Brand"]?.text || "").toLowerCase().includes(brandQ)) return false;
      if (modelQ && !(row["Model"]?.text || "").toLowerCase().includes(modelQ)) return false;
      return true;
    });
  }, [catalogueLinks, catalogueSearchFirm, catalogueSearchName, catalogueSearchCatalogueId, catalogueSearchBrand, catalogueSearchModel]);

  // For each GeM Catalogue row, find the closest-matching item already in the Master List for
  // that same firm (by name similarity), so we can show whether it's already mapped/in use.
  const catalogueMasterListMatches = useMemo(() => {
    const map = new Map<number, { lst: FirmItemListing; score: number } | null>();
    filteredCatalogueLinks.forEach((row, idx) => {
      const name = row["Name"]?.text || "";
      if (!name) { map.set(idx, null); return; }
      const queryTokens = tokenizeMatchText(name);
      let best: FirmItemListing | null = null;
      let bestScore = 0;
      listings.forEach((lst) => {
        if (!lst?.itemName) return;
        if ((lst.firmCode || "").toLowerCase().trim() !== (row.firmCode || "").toLowerCase().trim()) return;
        const { score, overlap } = scoreTokenSimilarity(queryTokens, tokenizeMatchText(lst.itemName));
        if (score > bestScore && overlap >= 1) { bestScore = score; best = lst; }
      });
      map.set(idx, best && bestScore >= 0.5 ? { lst: best, score: bestScore } : null);
    });
    return map;
  }, [filteredCatalogueLinks, listings]);

  const lastCatalogueSyncAt = useMemo(() => {
    if (catalogueLinks.length === 0) return null;
    return catalogueLinks.reduce((latest: string, row: any) =>
      row.fetchedAt && (!latest || row.fetchedAt > latest) ? row.fetchedAt : latest, "");
  }, [catalogueLinks]);

  return (
    <BlockGuard permission="gemLinks">
      <div className="p-4 md:p-8 bg-[#f3f6f9] min-h-screen text-[var(--gem-text-primary)] font-sans">
        <div className="w-full mx-auto">

          {/* Header */}
          <div className="flex items-center gap-4 mb-8">
            <Link href="/dashboard/gem-sync" className="flex items-center justify-center w-10 h-10 rounded-xl bg-white border border-slate-200 shadow-sm hover:text-blue-600 transition-all text-slate-500 active:scale-95">
              <FiArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="text-2xl font-black uppercase tracking-tight text-slate-800">GeM Catalogue</h1>
              <p className="text-blue-600 text-[10px] font-black tracking-widest uppercase mt-1">Catalogue Product Links (Browser Extension Sync)</p>
            </div>
          </div>

          <div className="bg-[var(--gem-card)] rounded-2xl border border-[var(--gem-border)] shadow-xl overflow-hidden gem-sync-card">
            <div className="p-6 border-b border-[var(--gem-border)] bg-[var(--gem-table-header)] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h3 className="font-black text-sm text-[var(--gem-text-primary)] uppercase tracking-wider flex items-center gap-2">
                  <FiLink className="text-blue-500" /> GeM Catalogue Links
                </h3>
                <p className="text-xs text-[var(--gem-text-secondary)] mt-1">
                  Fetched via the GEM-LINK-FETCH browser extension on your GeM catalogue page.
                  {lastCatalogueSyncAt && (
                    <> Last synced: {formatDate(lastCatalogueSyncAt)}</>
                  )}
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 w-full sm:w-auto">
                <div className="relative">
                  <FiSearch className="absolute left-3 top-2.5 text-[var(--gem-text-secondary)] text-xs" />
                  <input
                    type="text"
                    placeholder="Firm..."
                    className="w-full bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl py-2 pl-8 pr-3 text-xs text-[var(--gem-text-primary)] focus:outline-none focus:border-blue-500"
                    value={catalogueSearchFirm}
                    onChange={(e) => setCatalogueSearchFirm(e.target.value)}
                  />
                </div>
                <div className="relative">
                  <FiSearch className="absolute left-3 top-2.5 text-[var(--gem-text-secondary)] text-xs" />
                  <input
                    type="text"
                    placeholder="Product name..."
                    className="w-full bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl py-2 pl-8 pr-3 text-xs text-[var(--gem-text-primary)] focus:outline-none focus:border-blue-500"
                    value={catalogueSearchName}
                    onChange={(e) => setCatalogueSearchName(e.target.value)}
                  />
                </div>
                <div className="relative">
                  <FiSearch className="absolute left-3 top-2.5 text-[var(--gem-text-secondary)] text-xs" />
                  <input
                    type="text"
                    placeholder="Gem Catalogue Id..."
                    className="w-full bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl py-2 pl-8 pr-3 text-xs text-[var(--gem-text-primary)] focus:outline-none focus:border-blue-500"
                    value={catalogueSearchCatalogueId}
                    onChange={(e) => setCatalogueSearchCatalogueId(e.target.value)}
                  />
                </div>
                <div className="relative">
                  <FiSearch className="absolute left-3 top-2.5 text-[var(--gem-text-secondary)] text-xs" />
                  <input
                    type="text"
                    placeholder="Brand..."
                    className="w-full bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl py-2 pl-8 pr-3 text-xs text-[var(--gem-text-primary)] focus:outline-none focus:border-blue-500"
                    value={catalogueSearchBrand}
                    onChange={(e) => setCatalogueSearchBrand(e.target.value)}
                  />
                </div>
                <div className="relative">
                  <FiSearch className="absolute left-3 top-2.5 text-[var(--gem-text-secondary)] text-xs" />
                  <input
                    type="text"
                    placeholder="Model..."
                    className="w-full bg-[var(--gem-table-header)] border border-[var(--gem-border)] rounded-xl py-2 pl-8 pr-3 text-xs text-[var(--gem-text-primary)] focus:outline-none focus:border-blue-500"
                    value={catalogueSearchModel}
                    onChange={(e) => setCatalogueSearchModel(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {loading ? (
              <div className="p-12 text-center text-[var(--gem-text-secondary)] space-y-2">
                <p className="text-xs">Loading catalogue links...</p>
              </div>
            ) : filteredCatalogueLinks.length === 0 ? (
              <div className="p-12 text-center text-[var(--gem-text-secondary)] space-y-2">
                <FiLink size={32} className="mx-auto text-slate-400" />
                <p className="text-xs">
                  {catalogueLinks.length === 0
                    ? "No catalogue links synced yet. Run the browser extension on your GeM catalogue page to fetch them here."
                    : "No items match your search."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[var(--gem-table-header)] text-[var(--gem-text-secondary)] font-bold uppercase tracking-wider border-b border-[var(--gem-border)]">
                      <th className="py-3.5 px-6">Firm</th>
                      <th className="py-3.5 px-6">Name</th>
                      <th className="py-3.5 px-6">Gem Catalogue Id</th>
                      <th className="py-3.5 px-6">Category</th>
                      <th className="py-3.5 px-6">Brand</th>
                      <th className="py-3.5 px-6 text-right">Offer Price</th>
                      <th className="py-3.5 px-6 text-center">Status</th>
                      <th className="py-3.5 px-6 text-right">Current Stock</th>
                      <th className="py-3.5 px-6 text-right">Min Qty/Consignee</th>
                      <th className="py-3.5 px-6">GeM Link</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--gem-border)]/40">
                    {filteredCatalogueLinks.map((row, idx) => {
                      // Prefer the Action column's link (this seller's own offering page) - the
                      // Name / Gem Catalogue Id links open a shared multi-seller listing page instead.
                      const gemCell = row["Action"]?.href ? row["Action"] : (row["Name"]?.href ? row["Name"] : row["Gem Catalogue Id"]);
                      return (
                        <tr key={idx} className="hover:bg-[var(--gem-table-row-hover)] transition-colors">
                          <td className="py-4 px-6">
                            <span className="bg-[var(--gem-table-header)] py-1 px-2.5 rounded-lg border border-[var(--gem-border)] text-[11px] font-bold text-[var(--gem-text-primary)]">
                              {row.firmCode || "—"}
                            </span>
                          </td>
                          <td className="py-4 px-6 font-bold text-[var(--gem-text-primary)]">
                            <div className="flex items-center gap-1.5">
                              <span>{row["Name"]?.text || "—"}</span>
                              {(() => {
                                const masterMatch = catalogueMasterListMatches.get(idx);
                                return masterMatch ? (
                                  <span
                                    className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 shrink-0"
                                    title={`In Master List as "${masterMatch.lst.itemName}" (${Math.round(masterMatch.score * 100)}% match)`}
                                  >
                                    <FiCheckCircle size={11} />
                                  </span>
                                ) : (
                                  <span
                                    className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-50 text-amber-500 border border-amber-200 shrink-0"
                                    title="Not found in Master List yet — not mapped to any requirement"
                                  >
                                    <FiAlertTriangle size={11} />
                                  </span>
                                );
                              })()}
                            </div>
                          </td>
                          <td className="py-4 px-6 font-mono text-[var(--gem-text-secondary)]">{row["Gem Catalogue Id"]?.text || "—"}</td>
                          <td className="py-4 px-6 text-[var(--gem-text-secondary)]">{row["Category"]?.text || "—"}</td>
                          <td className="py-4 px-6 text-[var(--gem-text-secondary)]">{row["Brand"]?.text || "—"}</td>
                          <td className="py-4 px-6 text-right font-mono font-bold text-[var(--gem-text-primary)]">{row["Offer Price"]?.text || "—"}</td>
                          <td className="py-4 px-6 text-center">
                            <span className="bg-[var(--gem-table-header)] py-1 px-2.5 rounded-lg border border-[var(--gem-border)] text-[10px] font-bold text-[var(--gem-text-primary)]">
                              {row["Product Status"]?.text || "—"}
                            </span>
                          </td>
                          <td className="py-4 px-6 text-right font-mono text-[var(--gem-text-primary)]">{row.currentStock ?? "—"}</td>
                          <td className="py-4 px-6 text-right font-mono text-[var(--gem-text-primary)]">{row.minQtyPerConsignee ?? "—"}</td>
                          <td className="py-4 px-6">
                            {gemCell?.href ? (
                              <div className="flex items-center gap-2">
                                <a
                                  href={gemCell.href}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-blue-600 hover:underline flex items-center gap-1"
                                >
                                  Open <FiExternalLink size={12} />
                                </a>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(gemCell.href);
                                    alert("✓ Link copied to clipboard!");
                                  }}
                                  className="p-1 rounded bg-sky-50 hover:bg-sky-100 text-sky-600 border border-sky-200 hover:border-sky-300 transition-colors cursor-pointer"
                                  title="Copy Link"
                                >
                                  <FiCopy size={11} />
                                </button>
                              </div>
                            ) : (
                              <span className="text-[var(--gem-text-secondary)] italic">No link</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
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
