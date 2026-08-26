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
  // Only set on listings created via "Add to Master List" below - links this
  // Master List entry back to its GeM Catalogue row so future catalogue/stock
  // re-fetches can auto-refresh price/stock/minQty on it (see the catalogue
  // sync route's save_catalogue_links / save_stock_fields actions).
  gemCatalogueId?: string;
}

// Same identity a catalogue row is deduplicated by server-side
// (save_catalogue_links) - Gem Catalogue Id, falling back to ProductID, then
// Name if GeM's own id wasn't scraped for some reason.
function getCatalogueProductId(row: any): string {
  return (row["Gem Catalogue Id"]?.text || row["ProductID"]?.text || row["Name"]?.text || "").toString().trim();
}

// The direct public product page (mkp.gem.gov.in/.../p-{id}.html) - opens
// straight to the product, no login needed. The "Action" column's link goes
// to admin-mkp.gem.gov.in's seller admin panel instead, which always bounces
// to GeM's SSO login unless that exact browser is already signed into that
// specific firm's GeM account - confirmed live 26-Aug-2026 this was opening
// a login wall instead of the product. Name/Gem Catalogue Id only ever fall
// back to Action if neither was scraped at all.
function getPublicProductLink(row: any): { text: string; href: string | null } | undefined {
  if (row["Name"]?.href) return row["Name"];
  if (row["Gem Catalogue Id"]?.href) return row["Gem Catalogue Id"];
  return row["Action"];
}

export default function GeMCataloguePage() {
  const [catalogueLinks, setCatalogueLinks] = useState<any[]>([]);
  const [listings, setListings] = useState<FirmItemListing[]>([]);
  const [stockItems, setStockItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Per-row (keyed by firmCode::productId, stable across re-filtering) state
  // for the inventory-link workflow below.
  const [selectedInventoryByRow, setSelectedInventoryByRow] = useState<Record<string, string>>({});
  const [addingRowKey, setAddingRowKey] = useState<string | null>(null);
  const [syncingMasterList, setSyncingMasterList] = useState(false);

  const [catalogueSearchFirm, setCatalogueSearchFirm] = useState("");
  const [catalogueSearchName, setCatalogueSearchName] = useState("");
  const [catalogueSearchCatalogueId, setCatalogueSearchCatalogueId] = useState("");
  const [catalogueSearchBrand, setCatalogueSearchBrand] = useState("");
  const [catalogueSearchModel, setCatalogueSearchModel] = useState("");

  // Renders only this many rows at a time - each row's inventory-link datalist
  // carries every stock item as an <option>, so rendering hundreds of catalogue
  // rows at once multiplies into a huge DOM (confirmed live: this was the
  // direct cause of a Chrome tab "Out of Memory" crash on this page with the
  // full unpaginated list). "Load More" grows this in fixed steps instead.
  const PAGE_SIZE = 20;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    fetch("/api/gem-sync?catalogue=1")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.catalogueLinks)) setCatalogueLinks(data.catalogueLinks);
        if (Array.isArray(data.listings)) setListings(data.listings);
      })
      .catch((err) => console.error("Error fetching GeM catalogue:", err))
      .finally(() => setLoading(false));

    fetch("/api/stock")
      .then((res) => res.json())
      .then((data) => { if (Array.isArray(data)) setStockItems(data); })
      .catch((err) => console.error("Error fetching stock for inventory link:", err));
  }, []);

  // productId::firmCode -> true, for O(1) "already added" lookups per row.
  const masterListedKeys = useMemo(() => {
    const keys = new Set<string>();
    listings.forEach((lst) => {
      if (lst.gemCatalogueId) keys.add(`${lst.gemCatalogueId.trim().toLowerCase()}::${(lst.firmCode || "").trim().toLowerCase()}`);
    });
    return keys;
  }, [listings]);

  const handleAddToMasterList = async (row: any, rowKey: string, itemId: string) => {
    const item = stockItems.find((i: any) => i._id === itemId);
    if (!item) return;
    setAddingRowKey(rowKey);
    try {
      const gemCatalogueId = getCatalogueProductId(row);
      const priceText = row["Offer Price"]?.text;
      const rate = priceText ? parseFloat(String(priceText).replace(/[^0-9.]/g, "")) : 0;
      const gemCell = getPublicProductLink(row);

      const res = await fetch("/api/gem-sync?action=add_to_master_list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gemCatalogueId,
          firmCode: row.firmCode,
          itemId: item._id,
          itemName: item.itemName,
          gemLink: gemCell?.href || "",
          rate,
          availGemStock: row.currentStock ?? 0,
          minQty: row.minQtyPerConsignee ?? 1,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setListings((prev) => [...prev, data.listing]);
      } else {
        alert(data.error || "Failed to add to Master List");
      }
    } catch (err) {
      console.error("Add to Master List failed:", err);
      alert("Failed to add to Master List");
    } finally {
      setAddingRowKey(null);
    }
  };

  // Bulk-matches every GeM Catalogue row against the Master List by EXACT
  // identity only - GeM's own Product ID + firmCode. A listing only gets its
  // Rate/Stock/Min Qty refreshed if it's already tagged with that exact
  // product id (via "Add to Master List"), never by guessing from names -
  // see the API route for why.
  const handleSyncMasterListNow = async () => {
    setSyncingMasterList(true);
    try {
      const res = await fetch("/api/gem-sync?action=sync_master_list_from_catalogue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json();
      if (res.ok) {
        alert(
          `✓ ${data.updated} Master List item(s) refreshed by exact Product ID + Firm match. ` +
          `${data.unmatched} catalogue item(s) had no exact match (out of ${data.totalCatalogueRows} total).`
        );
        const catalogueRes = await fetch("/api/gem-sync?catalogue=1");
        const catalogueData = await catalogueRes.json();
        if (Array.isArray(catalogueData.listings)) setListings(catalogueData.listings);
      } else {
        alert(data.error || "Sync failed");
      }
    } catch (err) {
      console.error("Sync Master List Now failed:", err);
      alert("Sync failed");
    } finally {
      setSyncingMasterList(false);
    }
  };

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

  // A new search should start back at the first page, not stay scrolled deep
  // into whatever was previously loaded.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [catalogueSearchFirm, catalogueSearchName, catalogueSearchCatalogueId, catalogueSearchBrand, catalogueSearchModel]);

  const paginatedCatalogueLinks = useMemo(
    () => filteredCatalogueLinks.slice(0, visibleCount),
    [filteredCatalogueLinks, visibleCount]
  );

  // For each GeM Catalogue row, find the closest-matching item already in the Master List for
  // that same firm (by name similarity), so we can show whether it's already mapped/in use.
  // Only computed for the currently-visible page, not the whole filtered set.
  const catalogueMasterListMatches = useMemo(() => {
    const map = new Map<number, { lst: FirmItemListing; score: number } | null>();
    paginatedCatalogueLinks.forEach((row, idx) => {
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
  }, [paginatedCatalogueLinks, listings]);

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

              <button
                type="button"
                onClick={handleSyncMasterListNow}
                disabled={syncingMasterList}
                title="Match every catalogue item against the Master List by exact Product ID + Firm and refresh Rate/Stock/Min Qty for matches found"
                className="shrink-0 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider py-2 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50"
              >
                {syncingMasterList ? "Syncing..." : "Sync Master List Now"}
              </button>

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
                      <th className="py-3.5 px-6 min-w-[220px]">Link to Inventory</th>
                      <th className="py-3.5 px-6">GeM Link</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--gem-border)]/40">
                    {paginatedCatalogueLinks.map((row, idx) => {
                      const gemCell = getPublicProductLink(row);
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
                          <td className="py-4 px-6 min-w-[220px]">
                            {(() => {
                              const productId = getCatalogueProductId(row);
                              const dedupeKey = `${productId.trim().toLowerCase()}::${(row.firmCode || "").trim().toLowerCase()}`;
                              const alreadyAdded = productId && masterListedKeys.has(dedupeKey);
                              const rowKey = `${row.firmCode || ""}::${productId}`;
                              const selectedId = selectedInventoryByRow[rowKey] || "";
                              const selectedItem = stockItems.find((i: any) => i._id === selectedId);

                              if (alreadyAdded) {
                                return (
                                  <button
                                    disabled
                                    className="w-full text-[10px] font-black uppercase tracking-wider py-2 px-3 rounded-lg bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"
                                  >
                                    Already Added
                                  </button>
                                );
                              }

                              return (
                                <div className="space-y-1.5">
                                  <input
                                    type="text"
                                    list={`inv-options-${idx}`}
                                    placeholder="Search or select stock..."
                                    defaultValue={selectedItem ? `${selectedItem.sku} - ${selectedItem.itemName}` : ""}
                                    className="w-full bg-[var(--gem-table-header)] border border-[var(--gem-border)] text-[11px] font-bold text-[var(--gem-text-primary)] rounded-lg p-1.5 focus:outline-none focus:border-blue-500"
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      if (!val) {
                                        setSelectedInventoryByRow((prev) => ({ ...prev, [rowKey]: "" }));
                                        return;
                                      }
                                      const match = stockItems.find(
                                        (item: any) => `${item.sku} - ${item.itemName}` === val || item.itemName === val
                                      );
                                      setSelectedInventoryByRow((prev) => ({ ...prev, [rowKey]: match ? match._id : "" }));
                                    }}
                                  />
                                  <datalist id={`inv-options-${idx}`}>
                                    {stockItems.map((item: any) => (
                                      <option key={item._id} value={`${item.sku} - ${item.itemName}`} />
                                    ))}
                                  </datalist>
                                  {selectedId && (
                                    <button
                                      type="button"
                                      disabled={addingRowKey === rowKey}
                                      onClick={() => handleAddToMasterList(row, rowKey, selectedId)}
                                      className="w-full text-[10px] font-black uppercase tracking-wider py-1.5 px-3 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
                                    >
                                      {addingRowKey === rowKey ? "Adding..." : "Add to Master List"}
                                    </button>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
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
                                    navigator.clipboard.writeText(gemCell.href || "");
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

            {!loading && filteredCatalogueLinks.length > 0 && (
              <div className="p-5 border-t border-[var(--gem-border)] flex flex-col items-center gap-2.5">
                <p className="text-[11px] text-[var(--gem-text-secondary)] font-semibold">
                  Showing {paginatedCatalogueLinks.length} of {filteredCatalogueLinks.length} items
                </p>
                {visibleCount < filteredCatalogueLinks.length && (
                  <button
                    type="button"
                    onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
                    className="text-xs font-black uppercase tracking-wider py-2.5 px-6 rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                  >
                    Load More Items
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </BlockGuard>
  );
}
