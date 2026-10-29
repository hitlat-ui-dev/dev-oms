"use client";
import { useState, useEffect, useMemo, useRef, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
  FiFolder,
  FiX,
  FiPercent,
  FiCopy,
  FiCheck,
} from "react-icons/fi";
import BlockGuard from "@/components/BlockGuard";
import { guessInstituteForAddress, SellerLite } from "@/lib/gemBids/instituteMatch";
import { parseGemDate } from "@/lib/gemBids/expirySweep";
import { normalizeName } from "@/lib/pricelist/normalize";
import PricelistRateChip, { PricelistRate } from "@/components/purchase/pricelist/PricelistRateChip";
import ReceivedRateChip, { ReceivedRate } from "@/components/purchase/pricelist/ReceivedRateChip";
import RateSuggestions, { RateSuggestion } from "@/components/purchase/pricelist/RateSuggestions";

interface Company {
  _id: string;
  firmName: string;
  firmCode: string;
}

// S S Enterprise - the firm this page is opened for the overwhelming
// majority of the time, so it starts pre-selected instead of making that
// one click happen every single time. Still a completely ordinary
// selection otherwise - the Firm dropdown switches away from it exactly
// like any other firm, and picking a bid with a different party assigned
// still overrides it the same way it always has.
const DEFAULT_FIRM_ID = "6a152c56ab2d240a19100e6b";

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
  address?: string;
  departmentNameAndAddress?: string;
  selectedPartyIds?: string[];
  selectedPartyId?: string | null;
  bidLink?: string;
  buyerAddedBidSpecificAtcUrl?: string;
  bidToRaEnabled?: string;
  raQualificationRule?: string;
  typeOfBid?: string;
  evaluationMethod?: string;
  emdAmount?: string;
  bidEndDateTime?: string;
  bidType?: "regular" | "boq";
}

interface BoqItem {
  itemNumber: string;
  itemTitle: string;
  itemDescription: string;
  quantity: string;
  unit: string;
  consigneeId: string;
  deliveryPeriod: string;
  baseRate: string;
  marginPercent: string;
  rate: string;
  suggestedRate: string;
  suggestedFromBidNo: string;
  // From the bid's separately-uploaded Specification Document, matched in
  // by Item Number server-side (see /api/gem-bids/boq's GET) - blank for a
  // bid with none uploaded, or a Regular Bid (no Specification concept).
  specification?: string;
  // Real GeM result data (who actually won, at what rate) imported from
  // the user's own result-scraping extension - see
  // lib/documentMaker/marketRateEngine.ts. marketRate is the MOST RECENT
  // result for this item (not an average - a trend needs real history,
  // not a blurred single number), marketRateSamples the up-to-5 most
  // recent full rows (rate/party/date/place/evaluation type) behind it,
  // newest first, for the hover table.
  marketRate?: string;
  marketRateSampleCount?: number;
  marketRateSamples?: { rate: number; party: string; date: string | null; place: string; evaluationType: string; bidNo: string }[];
  // What we actually paid a vendor for this item, per the Received
  // Purchase ledger (token-matched server-side, see /api/gem-bids/boq's
  // GET) - a cost reference for Base Rate, not Rate, so it's shown under
  // that input instead of next to the Rate suggestions.
  purchaseRate?: string;
  purchaseVendor?: string;
  purchaseDate?: string | null;
}

// Rate = Base Rate marked up by Margin % - recomputed live whenever either
// changes, so Rate always reflects the two unless the base is blank (then
// there's nothing to compute from, and Rate is left alone rather than
// cleared - a directly-typed Rate, e.g. from "Use suggested rate" below,
// stays valid without a base/margin behind it at all).
function computeRateFromBase(baseRate: string, marginPercent: string): string {
  const base = parseFloat(baseRate);
  if (!base) return "";
  const pct = parseFloat(marginPercent) || 0;
  return String(Math.round(base * (1 + pct / 100) * 100) / 100);
}

// ATC/rate-filling only ever make sense for a bid that's actually being
// worked - restricting the shared bid picker to these two sections (rather
// than every bid ever scraped) is both a usability filter and a guardrail
// against generating paperwork or rates for a bid nobody's decided to
// pursue yet.
const ATC_ELIGIBLE_SECTIONS = new Set(["bids_to_fill", "submitted_bids"]);

// Same default ₹-bracket table and ± random-offset logic as the standalone
// Rate Variant Tool (public/tools/rate-variant-tool.html, "Fixed ₹ Rate
// Variants" mode) - kept in sync by hand rather than shared, since that
// tool runs standalone in an iframe with its own bundled copy of this
// logic and no module boundary to import across. A cheap item gets a
// small ± difference, an expensive one a much larger one, so the variant
// still reads as a plausible competing quote rather than a flat % that's
// either trivial or wild depending on the item's price.
const RATE_VARIANT_BRACKETS = [
  { from: 0, to: 10, min: 0.5, max: 0.5 },
  { from: 10, to: 100, min: 1, max: 4 },
  { from: 100, to: 500, min: 10, max: 30 },
  { from: 500, to: 1000, min: 20, max: 30 },
  { from: 1000, to: 3000, min: 50, max: 130 },
  { from: 3000, to: 20000, min: 150, max: 400 },
];
function bracketForRate(rate: number) {
  for (const b of RATE_VARIANT_BRACKETS) if (rate >= b.from && rate <= b.to) return b;
  return RATE_VARIANT_BRACKETS[RATE_VARIANT_BRACKETS.length - 1];
}
function makeVariantRate(rate: number): { rate: number; diff: number } {
  const b = bracketForRate(rate);
  const mag = b.min === b.max ? b.min : b.min + Math.random() * (b.max - b.min);
  const sign = Math.random() < 0.5 ? 1 : -1;
  let diff = Math.round(sign * mag * 100) / 100;
  let newRate = rate + diff;
  if (newRate <= 0) {
    newRate = rate + Math.abs(diff);
    diff = Math.abs(diff);
  }
  return { rate: Math.round(newRate * 100) / 100, diff };
}

interface RateVariantRow {
  itemNumber: string;
  itemTitle: string;
  qty: number;
  baseRate: number;
  baseTotal: number;
  variants: { rate: number; diff: number; total: number }[];
}

// BOQ Rate Variants: unlike the ± Rate Variants above (just a what-if
// preview), this builds the two actual files needed to submit under
// multiple seller accounts - a GeM-ready "BOQ-Filled" workbook (same
// VARIANT 1/2/3 + TOTAL column layout, and the same L1=dark green/
// L2=light green/L3=blue color coding, as a real reference file the user
// supplied) and one "gem-offer-price-items" upload file per variant, in
// GeM's own exact 3-column format. Variant 1 (L1) is always exactly the
// already-filled Rate column, unchanged; every variant after it is bumped
// UP only (never down, unlike the ± tool) by a cumulative random amount
// from the same brackets, so the grand total strictly increases L1 < L2 <
// L3 by construction - the whole point being that L1 always wins.
const BOQ_VARIANT_COLORS = ["00B050", "92D050", "00B0F0"]; // L1, L2, L3 - matches the user's own reference file exactly
const DEFAULT_BOQ_VARIANT_L2_PERCENT = "0.5";
const DEFAULT_BOQ_VARIANT_L3_PERCENT = "0.7";
// GeM's own gem-offer-price-items export title-cases each item and
// appends "∗ :" (confirmed against a real sample file) - replicated
// exactly so the generated file matches what GeM itself would produce.
function toGemOfferItemLabel(title: string): string {
  const titleCased = (title || "").replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return `${titleCased}∗ :`;
}

interface BoqVariantRow {
  itemNumber: string;
  itemTitle: string;
  itemDescription: string;
  quantity: string;
  unit: string;
  consigneeId: string;
  deliveryPeriod: string;
  rate: number;
  variants: { rate: number; total: number }[];
}

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

type Tab = "rate" | "generate" | "variant";

function DocumentMakerPageInner() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>("rate");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [firmId, setFirmId] = useState(DEFAULT_FIRM_ID);
  const [vault, setVault] = useState<Vault | null>(null);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [vaultModalOpen, setVaultModalOpen] = useState(false);

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

  // Bid selection is shared - picked once, above the Rate/Generate tabs,
  // and both tabs react to it, rather than each having its own picker (the
  // old "Generate" tab used to have its own, now removed in favor of this).
  const [bids, setBids] = useState<GemBid[]>([]);
  const [selectedBidId, setSelectedBidId] = useState("");
  const [generatingAtc, setGeneratingAtc] = useState(false);
  const [atcPhase, setAtcPhase] = useState<"idle" | "fetching" | "generating">("idle");
  const [atcResult, setAtcResult] = useState<DownloadResult | null>(null);

  // Backs the matched-institute guess shown under the bid picker - same
  // /api/sellers + gemLocationText data (and the same matching algorithm,
  // see lib/gemBids/instituteMatch.ts) the GeM Bids table's Address column
  // and Fetch GeM Orders page already use.
  const [sellers, setSellers] = useState<SellerLite[]>([]);

  // The real multi-page ATC + Bid Document are fetched by the GeM Bid
  // Exporter extension (GeM blocks non-browser requests - see
  // /api/gem-bids/cities's note), not this page directly - Generate ATC
  // below queues this itself and waits for it, no separate button needed.
  const [docFetchStatus, setDocFetchStatus] = useState<DocFetchStatus | null>(null);
  const [hasBidDocument, setHasBidDocument] = useState(false);
  const [hasAtcDocument, setHasAtcDocument] = useState(false);
  const [hasBoqDocument, setHasBoqDocument] = useState(false);
  const [hasSpecDocument, setHasSpecDocument] = useState(false);

  const [bundling, setBundling] = useState(false);
  const [bundleResult, setBundleResult] = useState<BundleResult | null>(null);

  // Rate tab - BOQ items/rates for the selected bid (see /api/gem-bids/boq*).
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  // Supplier pricelist rates (Purchase > Pricelist) keyed by normalized item name - one batched
  // call per set of item titles, refetched only when the titles themselves change.
  const [pricelistRates, setPricelistRates] = useState<Record<string, PricelistRate[]>>({});
  // Same call also returns what we actually paid (Received Purchase items tagged with this bid item name) - shown green.
  const [receivedRates, setReceivedRates] = useState<Record<string, ReceivedRate[]>>({});
  // Near-miss tag names (similarity hints, never auto-linked) for items without an exact tag match.
  const [rateSuggestions, setRateSuggestions] = useState<Record<string, RateSuggestion[]>>({});
  const pricelistTitlesKey = useMemo(
    () => Array.from(new Set(boqItems.map((it) => normalizeName(it.itemTitle)).filter(Boolean))).sort().join("\n"),
    [boqItems]
  );
  useEffect(() => {
    if (!pricelistTitlesKey) {
      setPricelistRates({});
      setReceivedRates({});
      setRateSuggestions({});
      return;
    }
    const t = setTimeout(() => {
      fetch("/api/purchase/pricelist/rates-for-names", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names: pricelistTitlesKey.split("\n") }),
      })
        .then((r) => r.json())
        .then((d) => {
          setPricelistRates(d.rates || {});
          setReceivedRates(d.received || {});
          setRateSuggestions(d.suggestions || {});
        })
        .catch(() => {
          setPricelistRates({});
          setReceivedRates({});
          setRateSuggestions({});
        });
    }, 400);
    return () => clearTimeout(t);
  }, [pricelistTitlesKey]);
  const [loadingBoq, setLoadingBoq] = useState(false);
  const [savingBoq, setSavingBoq] = useState(false);
  const [uploadingBoq, setUploadingBoq] = useState(false);
  const [boqExportUrl, setBoqExportUrl] = useState<string | null>(null);
  const boqFileRef = useRef<HTMLInputElement>(null);
  const [uploadingSpec, setUploadingSpec] = useState(false);
  const specFileRef = useRef<HTMLInputElement>(null);
  // Typed once, applied to every row's own Margin % at a click - each row
  // stays individually editable afterward (this is a bulk-fill, not a
  // locked global setting).
  const [globalMarginPercent, setGlobalMarginPercent] = useState("");
  // Fill Rates table filter - "pending" hides a row the moment its Rate
  // column has anything in it, so it's purpose-built for working through a
  // long BOQ without re-scanning rows already done; doesn't touch Grand
  // Total, which always sums every item regardless of what's shown.
  const [boqFillFilter, setBoqFillFilter] = useState<"all" | "pending" | "filled">("all");
  // The row the cursor is currently in stays in whichever list it was in until focus leaves that row -
  // otherwise typing the first digit of a Rate would flip it Pending -> Filled and drop it (and the
  // cursor) mid-typing. It moves to its real list as soon as you go to another row / outside.
  const [pinnedBoqItem, setPinnedBoqItem] = useState<string | null>(null);

  // Rate Variants - generated from whatever's currently filled in the Rate
  // column above (see RATE_VARIANT_BRACKETS), same idea as the standalone
  // Rate Variant Tool just run inline on this bid's own items instead of a
  // separately uploaded file.
  const [variantCount, setVariantCount] = useState<2 | 3>(2);
  const [rateVariants, setRateVariants] = useState<RateVariantRow[] | null>(null);

  // BOQ Rate Variants - see BoqVariantRow/toGemOfferItemLabel above.
  // boqVariantParties holds each variant's selected company _id (not just a
  // display name) because its firmCode now feeds straight into the
  // generated gem-offer-price-items file name below, by request - no longer
  // "reference only".
  const [boqVariantCount, setBoqVariantCount] = useState<2 | 3>(2);
  const [boqVariantParties, setBoqVariantParties] = useState<Record<number, string>>({});
  // L1 is always exactly the filled Rate column; L2/L3 are each computed
  // straight off L1 (not chained off each other) as "item rate + this many
  // percent", independently configurable per request.
  const [boqVariantL2Percent, setBoqVariantL2Percent] = useState(DEFAULT_BOQ_VARIANT_L2_PERCENT);
  const [boqVariantL3Percent, setBoqVariantL3Percent] = useState(DEFAULT_BOQ_VARIANT_L3_PERCENT);
  const [boqRateVariants, setBoqRateVariants] = useState<BoqVariantRow[] | null>(null);
  const [downloadingBoqVariants, setDownloadingBoqVariants] = useState(false);

  // Deep link from Final Rates ("Edit" on a row there opens this page with
  // the same bid already selected) - read once on mount, doesn't need to
  // react to the URL changing afterward since nothing on this page pushes
  // a new ?bidId= itself.
  useEffect(() => {
    const bidId = searchParams.get("bidId");
    if (bidId) setSelectedBidId(bidId);
    const tabParam = searchParams.get("tab");
    if (tabParam === "rate" || tabParam === "generate" || tabParam === "variant") setTab(tabParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    fetch("/api/sellers")
      .then((res) => res.json())
      .then((data) => setSellers(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load sellers", err));
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

  // The combobox below does its own free-text search/limit internally -
  // this just applies the fixed "only a bid actually being worked"
  // restriction every picker use shares.
  const eligibleBids = useMemo(() => bids.filter((b) => ATC_ELIGIBLE_SECTIONS.has(b.currentSection || "")), [bids]);

  const selectedBid = useMemo(() => bids.find((b) => b._id === selectedBidId) || null, [bids, selectedBidId]);

  // "boq" (GeM gave a BOQ Detail Document to upload/parse - the original,
  // still-default flow) or "regular" (built straight off a catalog Item
  // Link, no BOQ file at all - items are typed in by hand instead, see the
  // Fill Rates panel below). Derived straight from the bid itself, not a
  // separate piece of state, so toggling it (setBidType below, which
  // patches `bids` in place) and switching bids both just fall out of this
  // the same way everything else already keyed off selectedBid does.
  const bidType: "regular" | "boq" = selectedBid?.bidType === "regular" ? "regular" : "boq";

  const setBidType = async (type: "regular" | "boq") => {
    if (!selectedBidId) return;
    setBids((prev) => prev.map((b) => (b._id === selectedBidId ? { ...b, bidType: type } : b)));
    try {
      await fetch("/api/gem-bids/bid-type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidId: selectedBidId, bidType: type }),
      });
    } catch (err) {
      console.error("Failed to save bid type", err);
    }
  };

  // Computed once for every bid (not just the selected one, and not just
  // the eligible-for-picking ones - a deep-linked bidId from Final Rates
  // can point at a bid outside that list) so the Bid combobox's dropdown
  // can lead each row with its own matched institute name, not just Bid No
  // + item, and the info strip below still resolves correctly either way.
  const matchedInstituteByBidId = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of bids) {
      // address (not departmentNameAndAddress) is the field that actually
      // carries the specific institute's own location text - mirrors
      // GemBidTable's Address column, which is where this matching logic
      // was first built and verified. departmentNameAndAddress is the
      // generic GOVERNMENT DEPARTMENT name (e.g. "Labour and Employment
      // Department Gujarat"), shared by hundreds of unrelated bids, so
      // trying it first (the earlier version of this line did) meant it
      // almost always "matched" nothing and never even got to try the
      // field that actually works.
      const m = guessInstituteForAddress(b.address || "", sellers);
      if (m) map.set(b._id, m);
    }
    return map;
  }, [bids, sellers]);
  const matchedInstitute = selectedBid ? matchedInstituteByBidId.get(selectedBid._id) || null : null;

  // Same ≤3-day "urgent" threshold as GemBidTable's own row-highlight, so
  // this page's sense of "about to expire" matches what's shown there.
  const remainingTime = useMemo(() => {
    const end = parseGemDate(selectedBid?.bidEndDateTime);
    if (!end) return null;
    const daysLeft = (end.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    if (daysLeft < 0) return { label: "Expired", urgent: true };
    if (daysLeft < 1) return { label: "Ends today", urgent: true };
    const d = Math.ceil(daysLeft);
    return { label: `${d} day${d === 1 ? "" : "s"} left`, urgent: daysLeft <= 3 };
  }, [selectedBid]);

  // Once a bid is selected, the Firm dropdown narrows to just the party(ies)
  // already picked for it in Bids to Fill - picking a firm this ATC/rate
  // paperwork was never actually assigned to on the bid itself isn't a real
  // choice, so it isn't offered as one. Falls back to every firm when no
  // bid is selected yet, or the selected bid has no party picked.
  const firmOptions = useMemo(() => {
    const partyIds = selectedBid?.selectedPartyIds?.length
      ? selectedBid.selectedPartyIds
      : selectedBid?.selectedPartyId
      ? [selectedBid.selectedPartyId]
      : [];
    if (partyIds.length === 0) return companies;
    const idSet = new Set(partyIds);
    return companies.filter((c) => idSet.has(c._id));
  }, [companies, selectedBid]);

  // Picking a bid also picks its firm, rather than making it a second manual
  // step - whichever party was already selected for this bid in Bids to
  // Fill (GemBidTable's Party column) is who the ATC/rate paperwork is for
  // here too. A bid with more than one party selected (a mixed-eligibility
  // listing) uses the first one; the Firm dropdown stays freely overridable
  // afterward for anything that isn't a clean 1:1 match.
  useEffect(() => {
    const bid = bids.find((b) => b._id === selectedBidId);
    if (!bid) return;
    const partyIds = bid.selectedPartyIds?.length ? bid.selectedPartyIds : bid.selectedPartyId ? [bid.selectedPartyId] : [];
    if (partyIds.length > 0) setFirmId(partyIds[0]);
  }, [selectedBidId, bids]);

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
        setHasSpecDocument(!!data.hasSpecDocument);
      })
      .catch((err) => console.error("Failed to load document-fetch status", err));
  }, [selectedBidId]);

  useEffect(() => {
    setDocFetchStatus(null);
    setHasBidDocument(false);
    setHasAtcDocument(false);
    setHasBoqDocument(false);
    setHasSpecDocument(false);
    setAtcResult(null);
    setBundleResult(null);
    setBoqItems([]);
    setBoqExportUrl(null);
    setRateVariants(null);
    setBoqFillFilter("all");
    fetchDocStatus();
  }, [selectedBidId, fetchDocStatus]);

  const loadBoqItems = useCallback(async () => {
    if (!selectedBidId) return;
    setLoadingBoq(true);
    try {
      const res = await fetch(`/api/gem-bids/boq?bidId=${selectedBidId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load BOQ");
      setBoqItems(data.items || []);
    } catch (err: any) {
      console.error("Failed to load BOQ items", err);
      setBoqItems([]);
    } finally {
      setLoadingBoq(false);
    }
  }, [selectedBidId]);

  // Once a BOQ source file is known to exist for the selected bid (either
  // already fetched by the extension, or just uploaded below), load its
  // items + any already-saved rates automatically - no separate "load"
  // click needed. A Regular Bid has no file to wait on at all - its saved
  // items (if any) are loaded the moment it's selected.
  useEffect(() => {
    if (selectedBidId && (hasBoqDocument || bidType === "regular")) loadBoqItems();
  }, [hasBoqDocument, selectedBidId, bidType, loadBoqItems]);

  const uploadBoqFile = async (file: File) => {
    if (!selectedBidId) return;
    setUploadingBoq(true);
    try {
      const fd = new FormData();
      fd.append("bidId", selectedBidId);
      fd.append("kind", "boq");
      fd.append("file", file);
      const res = await fetch("/api/gem-bids/fetch-documents/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Upload failed");
      fetchDocStatus(); // refreshes hasBoqDocument, which triggers the auto-load effect above
    } catch (err: any) {
      alert(err.message || "Upload failed");
    } finally {
      setUploadingBoq(false);
    }
  };

  // Specification Document - uploaded separately from the BOQ Excel (GeM
  // shows them as two different downloads on the bid itself). Stored the
  // same way as the BOQ/ATC/Bid Document already are (see KIND_FIELD in
  // fetch-documents/upload/route.ts). Parsed and merged into the rate
  // table's Item Title/Unit columns server-side (see specEngine.ts), on
  // top of being previewable as-is via "BOQ Specifications" in the table.
  const uploadSpecFile = async (file: File) => {
    if (!selectedBidId) return;
    setUploadingSpec(true);
    try {
      const fd = new FormData();
      fd.append("bidId", selectedBidId);
      fd.append("kind", "spec");
      fd.append("file", file);
      const res = await fetch("/api/gem-bids/fetch-documents/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Upload failed");
      fetchDocStatus();
    } catch (err: any) {
      alert(err.message || "Upload failed");
    } finally {
      setUploadingSpec(false);
    }
  };

  // "Remove" next to Replace (both BOQ and Specification) - for a wrong
  // document auto-fetched from the Bid Document's own embedded links (see
  // autoDocLinksJob.ts) or uploaded by mistake. Doesn't touch
  // autoDocLinksCheckedAt, so that job never silently re-fetches whatever
  // was just removed on its own - Upload/Replace is the only way a new one
  // goes back in, same as any other deliberate action on this page.
  const [removingDoc, setRemovingDoc] = useState<"boq" | "spec" | null>(null);
  const removeDocument = async (kind: "boq" | "spec") => {
    if (!selectedBidId) return;
    if (!confirm(`Remove the ${kind === "boq" ? "BOQ Detail" : "Specification"} Document from this bid?`)) return;
    setRemovingDoc(kind);
    try {
      const res = await fetch("/api/gem-bids/fetch-documents/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidId: selectedBidId, kind }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to remove document");
      fetchDocStatus();
      if (kind === "boq") setBoqItems([]);
    } catch (err: any) {
      alert(err.message || "Failed to remove document");
    } finally {
      setRemovingDoc(null);
    }
  };

  // Signed R2 URL for a kind already fetched/uploaded for this bid (see
  // /api/gem-bids/document-preview) - opened directly in a new tab, same
  // "BOQ Specifications" preview link GemBidTable.tsx already has.
  const openDocPreview = async (bidId: string, kind: "boq" | "spec") => {
    try {
      const res = await fetch(`/api/gem-bids/document-preview?bidId=${bidId}&kind=${kind}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Preview failed");
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      alert(err.message || "Preview failed");
    }
  };

  const [copiedBidNo, setCopiedBidNo] = useState(false);
  const copyBidNo = async (bidNo: string) => {
    try {
      await navigator.clipboard.writeText(bidNo);
      setCopiedBidNo(true);
      setTimeout(() => setCopiedBidNo(false), 1500);
    } catch (err) {
      console.error("Failed to copy bid number", err);
    }
  };

  // Bid Results import (see lib/documentMaker/marketRateEngine.ts) - not
  // tied to the selected bid at all, unlike every other upload on this
  // panel: the Excel this reads already names its own bid number
  // internally, and what it feeds (gem_bid_item_market_rate_history) is
  // looked up by item title across every bid, not stored against one.
  const [importingMarketResults, setImportingMarketResults] = useState(false);
  const marketResultsFileRef = useRef<HTMLInputElement>(null);
  const importMarketResults = async (file: File) => {
    setImportingMarketResults(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/gem-bids/market-rates/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Import failed");
      alert(`Imported ${data.importedCount} item rate(s)${data.bidNo ? ` from ${data.bidNo}` : ""}.`);
      if (selectedBidId && (hasBoqDocument || bidType === "regular")) loadBoqItems(); // refresh suggestions if a bid's already open
    } catch (err: any) {
      alert(err.message || "Import failed");
    } finally {
      setImportingMarketResults(false);
    }
  };

  // Regular Bid items (see bidType above) have no source file to parse
  // from - the user builds the list by hand instead.
  const addRegularItem = () => {
    setBoqItems((prev) => [
      ...prev,
      {
        itemNumber: `r${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
        itemTitle: "",
        itemDescription: "",
        quantity: "",
        unit: "",
        consigneeId: "",
        deliveryPeriod: "",
        baseRate: "",
        marginPercent: "",
        rate: "",
        suggestedRate: "",
        suggestedFromBidNo: "",
      },
    ]);
  };

  const removeRegularItem = (itemNumber: string) => {
    setBoqItems((prev) => prev.filter((it) => it.itemNumber !== itemNumber));
  };

  // Alternative to typing every row by hand via Add Item: the same sample
  // Items/BOQ-style Excel GeM itself exports (Item Number/Title/
  // Description/Quantity/Unit of Measure/Consignee ID/Delivery Period
  // columns - see boqEngine.ts's mapRowsToBoqItems), parsed entirely
  // client-side (no upload/server round trip - unlike BOQ Bid mode, a
  // Regular Bid's items aren't tied to a stored source file at all, this
  // is just a one-off bulk way to seed rows that stay freely editable
  // afterward exactly like a manually-added one). Appended, not replacing
  // whatever's already there, so re-importing or importing on top of
  // hand-added rows never silently discards rates already typed in.
  const [importingRegularExcel, setImportingRegularExcel] = useState(false);
  const regularFileRef = useRef<HTMLInputElement>(null);
  const importRegularExcel = async (file: File) => {
    setImportingRegularExcel(true);
    try {
      const XLSX = (await import("xlsx-js-style")).default;
      const { mapRowsToBoqItems } = await import("@/lib/documentMaker/boqEngine");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheetName = wb.SheetNames[0];
      const rows = sheetName ? XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[sheetName], { defval: "" }) : [];
      const parsed = mapRowsToBoqItems(rows);
      if (parsed.length === 0) {
        alert("Couldn't find any item rows in this file (expected Item Number/Item Title/Item Quantity/Unit of Measure columns).");
        return;
      }
      setBoqItems((prev) => [
        ...prev,
        ...parsed.map((it) => ({
          ...it,
          // A plain file-row Item Number ("1", "2"...) can collide with
          // another import or with itself if the same number appears
          // twice in the sheet - re-keyed so every imported row gets its
          // own unique itemNumber the same way a manually-added one does,
          // while the file's own number is kept visible in itemTitle's
          // place is unnecessary; itemNumber is purely an internal row key
          // here (Regular Bid's table shows a plain running # instead).
          itemNumber: `r${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
          baseRate: "",
          marginPercent: "",
          rate: "",
          suggestedRate: "",
          suggestedFromBidNo: "",
        })),
      ]);
    } catch (err: any) {
      alert(err.message || "Failed to read this Excel file");
    } finally {
      setImportingRegularExcel(false);
    }
  };

  const updateRegularItemField = (itemNumber: string, field: "itemTitle" | "quantity" | "unit", value: string) => {
    setBoqItems((prev) => prev.map((it) => (it.itemNumber === itemNumber ? { ...it, [field]: value } : it)));
  };

  const updateBoqRate = (itemNumber: string, rate: string) => {
    setBoqItems((prev) => prev.map((it) => (it.itemNumber === itemNumber ? { ...it, rate } : it)));
  };

  // Rendered next to the "Use <suggestedRate>" button (our own past quote
  // for this item) in both the BOQ-bid and Regular-bid tables below - a
  // second, independent suggestion from real GeM result data (see
  // marketRateEngine.ts/Import Bid Results above). Averaged across however
  // many imported results matched this item by title.
  // Headline = the most recent result; hovering reveals the up-to-5-row
  // trend table behind it (rate/party/date/place/evaluation type, newest
  // first) - a native title tooltip can't hold a real table, so this is a
  // CSS-only (no per-row hover state needed) group-hover reveal instead.
  const renderMarketRateSuggestion = (it: BoqItem) => {
    if (!it.marketRate) return null;
    const samples = it.marketRateSamples || [];
    return (
      <div className="relative inline-block group/market mt-0.5">
        <button
          type="button"
          onClick={() => updateBoqRate(it.itemNumber, it.marketRate!)}
          className="text-[9px] text-purple-700 underline font-bold block"
        >
          Market L1: {it.marketRate}
          {it.marketRateSampleCount && it.marketRateSampleCount > 1 ? ` (${it.marketRateSampleCount} results)` : ""}
        </button>
        {samples.length > 0 && (
          <div className="hidden group-hover/market:block absolute z-50 left-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl p-2 w-max max-w-sm">
            <table className="text-[9px] border-collapse">
              <thead>
                <tr className="text-slate-400 font-black uppercase">
                  <th className="text-left pr-3 pb-1">Rate</th>
                  <th className="text-left pr-3 pb-1">L1 Party</th>
                  <th className="text-left pr-3 pb-1">Date</th>
                  <th className="text-left pr-3 pb-1">Place</th>
                  <th className="text-left pb-1">Eval</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {samples.map((s, i) => (
                  <tr key={i} className={i === 0 ? "font-bold text-slate-800" : "text-slate-500"}>
                    <td className="pr-3 py-0.5 whitespace-nowrap">{s.rate}</td>
                    <td className="pr-3 py-0.5 max-w-[110px] truncate" title={s.party}>
                      {s.party || "—"}
                    </td>
                    <td className="pr-3 py-0.5 whitespace-nowrap">{s.date ? new Date(s.date).toLocaleDateString("en-IN") : "—"}</td>
                    <td className="pr-3 py-0.5 max-w-[140px] truncate" title={s.place}>
                      {s.place || "—"}
                    </td>
                    <td className="py-0.5 whitespace-nowrap">
                      {s.evaluationType === "ITEM_WISE" ? "Item-wise" : s.evaluationType === "TOTAL" ? "Total" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  const renderPricelistRate = (it: BoqItem) => (
    <>
      <PricelistRateChip
        rates={pricelistRates[normalizeName(it.itemTitle)]}
        onUse={(rate) => updateBoqBaseRate(it.itemNumber, String(rate))}
      />
      <ReceivedRateChip
        rates={receivedRates[normalizeName(it.itemTitle)]}
        onUse={(rate) => updateBoqBaseRate(it.itemNumber, String(rate))}
      />
      <RateSuggestions
        items={rateSuggestions[normalizeName(it.itemTitle)]}
        onUse={(rate) => updateBoqBaseRate(it.itemNumber, String(rate))}
      />
    </>
  );

  const updateBoqBaseRate = (itemNumber: string, baseRate: string) => {
    setBoqItems((prev) =>
      prev.map((it) => (it.itemNumber === itemNumber ? { ...it, baseRate, rate: computeRateFromBase(baseRate, it.marginPercent) || it.rate } : it))
    );
  };

  const updateBoqMarginPercent = (itemNumber: string, marginPercent: string) => {
    setBoqItems((prev) =>
      prev.map((it) =>
        it.itemNumber === itemNumber ? { ...it, marginPercent, rate: computeRateFromBase(it.baseRate, marginPercent) || it.rate } : it
      )
    );
  };

  // "Apply to all" for the heading-level % control - sets every row's own
  // Margin % to this one value and recomputes each row's Rate from ITS OWN
  // Base Rate (not a single shared total), then stays a perfectly normal,
  // individually-editable per-row value afterward.
  const applyGlobalMarginPercent = () => {
    if (!globalMarginPercent.trim()) return;
    setBoqItems((prev) =>
      prev.map((it) => ({ ...it, marginPercent: globalMarginPercent, rate: computeRateFromBase(it.baseRate, globalMarginPercent) || it.rate }))
    );
  };

  const boqGrandTotal = useMemo(
    () => boqItems.reduce((sum, it) => sum + (parseFloat(it.quantity) || 0) * (parseFloat(it.rate) || 0), 0),
    [boqItems]
  );

  // Original index travels with each item (not recomputed per filtered
  // position) so the "#" column keeps matching the item's real place in the
  // uploaded BOQ even with rows hidden by the filter above it.
  const boqFilledCount = useMemo(() => boqItems.filter((it) => (parseFloat(it.rate) || 0) > 0).length, [boqItems]);
  const filteredBoqItems = useMemo(() => {
    const indexed = boqItems.map((it, idx) => ({ it, idx }));
    if (boqFillFilter === "all") return indexed;
    return indexed.filter(({ it }) => {
      if (it.itemNumber === pinnedBoqItem) return true;
      const hasRate = (parseFloat(it.rate) || 0) > 0;
      return boqFillFilter === "filled" ? hasRate : !hasRate;
    });
  }, [boqItems, boqFillFilter, pinnedBoqItem]);

  const generateRateVariants = () => {
    const rows: RateVariantRow[] = boqItems.map((it) => {
      const qty = parseFloat(it.quantity) || 0;
      const baseRate = parseFloat(it.rate) || 0;
      const variants = Array.from({ length: variantCount }, () => {
        if (!baseRate) return { rate: 0, diff: 0, total: 0 };
        const v = makeVariantRate(baseRate);
        return { ...v, total: Math.round(qty * v.rate * 100) / 100 };
      });
      return { itemNumber: it.itemNumber, itemTitle: it.itemTitle, qty, baseRate, baseTotal: qty * baseRate, variants };
    });
    setRateVariants(rows);
  };

  const rateVariantGrandTotals = useMemo(() => {
    if (!rateVariants) return [];
    return Array.from({ length: variantCount }, (_, i) => rateVariants.reduce((sum, r) => sum + (r.variants[i]?.total || 0), 0));
  }, [rateVariants, variantCount]);

  // Downloaded fully client-side (xlsx-js-style is already a project
  // dependency, used server-side for the BOQ export routes) rather than a
  // round trip through a new API route - this table only ever exists in
  // this tab's own state to begin with, nothing to fetch server-side for it.
  const downloadRateVariants = async () => {
    if (!rateVariants) return;
    const XLSX = (await import("xlsx-js-style")).default;
    const headers = ["Item Number", "Item Title", "Qty", "Rate", "Total"];
    for (let i = 0; i < variantCount; i++) headers.push(`Variant ${i + 1} Rate`, `Variant ${i + 1} Diff`, `Variant ${i + 1} Total`);
    const rows = rateVariants.map((r) => {
      const row: (string | number)[] = [r.itemNumber, r.itemTitle, r.qty, r.baseRate, r.baseTotal];
      r.variants.forEach((v) => row.push(v.rate, v.diff, v.total));
      return row;
    });
    const grandRow: (string | number)[] = ["", "", "", "Grand Total", boqGrandTotal];
    rateVariantGrandTotals.forEach((t) => grandRow.push("", "", t));
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows, grandRow]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rate Variants");
    XLSX.writeFile(wb, `Rate-Variants-${selectedBid?.bidNo || selectedBidId}.xlsx`);
  };

  const generateBoqRateVariants = () => {
    const percents = [parseFloat(boqVariantL2Percent) || 0, parseFloat(boqVariantL3Percent) || 0];
    const rows: BoqVariantRow[] = boqItems.map((it) => {
      const qty = parseFloat(it.quantity) || 0;
      const baseRate = parseFloat(it.rate) || 0;
      const variants: { rate: number; total: number }[] = [{ rate: baseRate, total: Math.round(qty * baseRate * 100) / 100 }];
      for (let v = 2; v <= boqVariantCount; v++) {
        const pct = percents[v - 2] || 0;
        const rate = baseRate ? Math.round(baseRate * (1 + pct / 100) * 100) / 100 : 0;
        variants.push({ rate, total: Math.round(qty * rate * 100) / 100 });
      }
      return {
        itemNumber: it.itemNumber,
        itemTitle: it.itemTitle,
        itemDescription: it.itemDescription,
        quantity: it.quantity,
        unit: it.unit,
        consigneeId: it.consigneeId,
        deliveryPeriod: it.deliveryPeriod,
        rate: baseRate,
        variants,
      };
    });
    setBoqRateVariants(rows);
  };

  const boqVariantGrandTotals = useMemo(() => {
    if (!boqRateVariants) return [];
    return Array.from({ length: boqVariantCount }, (_, i) => boqRateVariants.reduce((sum, r) => sum + (r.variants[i]?.total || 0), 0));
  }, [boqRateVariants, boqVariantCount]);

  // Builds the GeM-ready "BOQ-Filled" workbook (VARIANT 1/2/3 + TOTAL
  // columns, color-coded L1/L2/L3 exactly as the reference file does) plus
  // one "gem-offer-price-items" file per variant in GeM's own exact
  // upload format, bundled into one ZIP - same "bundle multiple generated
  // files together" pattern the ATC ZIP bundle already uses elsewhere in
  // this app, chosen over triggering several separate downloads at once
  // (unreliable - browsers can block/prompt on multi-file downloads).
  const downloadBoqRateVariants = async () => {
    if (!boqRateVariants) return;
    setDownloadingBoqVariants(true);
    try {
      const XLSX = (await import("xlsx-js-style")).default;
      const JSZip = (await import("jszip")).default;

      const safeBidNo = String(selectedBid?.bidNo || selectedBidId || "BOQ").replace(/[\\/:*?"<>|]/g, "-");

      const headers: (string | number)[] = [
        "Item Number",
        "Item Title",
        "Item Description",
        "Item Quantity",
        "Unit of Measure",
        "Consignee ID",
        "Delivery Period (In number of days)",
        "Rate",
      ];
      for (let v = 1; v <= boqVariantCount; v++) headers.push(`VARIANT ${v}`, `VARIANT ${v} TOTAL`);
      const aoa: (string | number)[][] = [headers];
      boqRateVariants.forEach((r) => {
        const row: (string | number)[] = [
          r.itemNumber,
          r.itemTitle,
          r.itemDescription,
          r.quantity,
          r.unit,
          r.consigneeId,
          r.deliveryPeriod,
          r.rate,
        ];
        r.variants.forEach((v) => row.push(v.rate, v.total));
        aoa.push(row);
      });
      const grandRow: (string | number)[] = ["", "", "", "", "", "", "", ""];
      boqVariantGrandTotals.forEach((t) => grandRow.push("", Math.round(t * 100) / 100));
      aoa.push(grandRow);

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      for (let v = 0; v < boqVariantCount; v++) {
        const colRate = 8 + v * 2;
        const colTotal = colRate + 1;
        const rgb = BOQ_VARIANT_COLORS[v];
        for (let r = 0; r <= boqRateVariants.length; r++) {
          for (const c of [colRate, colTotal]) {
            const addr = XLSX.utils.encode_cell({ r, c });
            if (ws[addr]) ws[addr].s = { fill: { patternType: "solid", fgColor: { rgb } } };
          }
        }
      }
      const mainWb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(mainWb, ws, "BOQ");
      const mainBuf = XLSX.write(mainWb, { type: "array", bookType: "xlsx" });

      const zip = new JSZip();
      const mainFileName = `BOQ-Filled-${safeBidNo}.xlsx`;
      zip.file(mainFileName, mainBuf);

      for (let v = 0; v < boqVariantCount; v++) {
        const offerAoa: (string | number)[][] = [["Item", "Quantity Required", "Unit Price Inclusive of all Taxes"]];
        boqRateVariants.forEach((r) => {
          offerAoa.push([toGemOfferItemLabel(r.itemTitle), r.quantity, r.variants[v]?.rate ?? ""]);
        });
        const offerWs = XLSX.utils.aoa_to_sheet(offerAoa);
        const offerWb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(offerWb, offerWs, "Offer Price");
        const offerBuf = XLSX.write(offerWb, { type: "array", bookType: "xlsx" });
        const partyShortName = companies.find((c) => c._id === boqVariantParties[v + 1])?.firmCode || "";
        zip.file(`gem-offer-price-items-${safeBidNo}-L${v + 1}${partyShortName ? `-${partyShortName}` : ""}.xlsx`, offerBuf);
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `BOQ-Filled-${safeBidNo}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message || "Failed to build the download");
    } finally {
      setDownloadingBoqVariants(false);
    }
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
          items: boqItems.map((it) => ({
            itemNumber: it.itemNumber,
            itemTitle: it.itemTitle,
            rate: it.rate,
            quantity: it.quantity,
            baseRate: it.baseRate,
            marginPercent: it.marginPercent,
            unit: it.unit,
          })),
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
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Link href="/dashboard/gem-bids" className="flex items-center gap-2 text-slate-500 hover:text-blue-600 text-xs mb-2 transition-colors w-fit">
                <FiArrowLeft /> Back to GeM Bids
              </Link>
              <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
                <FiFileText className="text-blue-600" /> Bid Rate
              </h1>
              <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mt-0.5">
                Rate Filling, Firm Document Vault &amp; ATC Generation
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTab("variant")}
                className={`flex items-center gap-1.5 font-black uppercase text-[11px] tracking-wide py-2.5 px-4 rounded-xl transition-colors ${
                  tab === "variant" ? "bg-purple-600 hover:bg-purple-700 text-white" : "bg-slate-900 hover:bg-slate-800 text-white"
                }`}
              >
                <FiPercent size={13} /> Rate Variant Tool
              </button>
              <button
                onClick={() => setVaultModalOpen(true)}
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white font-black uppercase text-[11px] tracking-wide py-2.5 px-4 rounded-xl transition-colors"
              >
                <FiFolder size={13} /> Document Vault
              </button>
            </div>
          </div>

          {/* Tabs, bid picker (shared - both tabs react to it), and firm -
              all one row. Selecting a bid also auto-picks its firm (see the
              effect above), so the firm dropdown here is mostly a display/
              override rather than something to set by hand every time. Rate
              Variant Tool isn't in this row - it's its own button up top
              (by request), since it doesn't need a bid/firm selected at all. */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl p-1">
              {([
                { key: "rate", label: "Rate" },
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
            <BidCombobox
              bids={eligibleBids}
              matchedInstituteById={matchedInstituteByBidId}
              value={selectedBidId}
              onChange={setSelectedBidId}
            />
            <select
              value={firmId}
              onChange={(e) => setFirmId(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs text-slate-700 focus:outline-none focus:border-blue-500 font-bold min-w-[200px] ml-auto"
            >
              <option value="">Select Firm...</option>
              {firmOptions.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.firmName} {c.firmCode ? `(${c.firmCode})` : ""}
                </option>
              ))}
            </select>
          </div>

          <p className="text-[10px] text-slate-400 -mt-4">
            Only bids in Bids to Fill or Submitted Bids are listed here.
            {selectedBid && firmOptions.length < companies.length && (
              <> Firm narrowed to this bid&apos;s {firmOptions.length} selected part{firmOptions.length === 1 ? "y" : "ies"}.</>
            )}
          </p>

          {selectedBid && (
            <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-[11px] bg-white border border-slate-200 rounded-xl px-3 py-2.5 shadow-sm">
              <span>
                <span className="font-black uppercase text-slate-400 mr-1">Bid No:</span>
                <span className="font-bold text-slate-700">{selectedBid.bidNo}</span>
                <button
                  type="button"
                  onClick={() => copyBidNo(selectedBid.bidNo)}
                  title="Copy Bid No"
                  className="inline-flex items-center ml-1.5 text-slate-400 hover:text-blue-600 align-middle"
                >
                  {copiedBidNo ? <FiCheck size={12} className="text-emerald-600" /> : <FiCopy size={12} />}
                </button>
              </span>
              <span>
                <span className="font-black uppercase text-slate-400 mr-1">Item:</span>
                <span className="font-bold text-slate-700">{selectedBid.items || "—"}</span>
              </span>
              <span>
                <span className="font-black uppercase text-slate-400 mr-1">Bid End Date/Time:</span>
                <span className={`font-bold ${remainingTime?.urgent ? "text-rose-600" : "text-slate-700"}`}>
                  {selectedBid.bidEndDateTime || "—"}
                </span>
                {remainingTime && (
                  <span className={`ml-1.5 font-black ${remainingTime.urgent ? "text-rose-600" : "text-slate-400"}`}>
                    ({remainingTime.label})
                  </span>
                )}
              </span>
              <span>
                <span className="font-black uppercase text-slate-400 mr-1">Institute:</span>
                <span className={`font-bold ${matchedInstitute ? "text-blue-700" : "text-slate-400"}`}>
                  {matchedInstitute || "No match"}
                </span>
              </span>
              <span>
                <span className="font-black uppercase text-slate-400 mr-1">Bid Doc:</span>
                {selectedBid.bidLink ? (
                  <a href={selectedBid.bidLink} target="_blank" rel="noreferrer" className="text-blue-600 underline font-bold">
                    Link
                  </a>
                ) : (
                  <span className="text-slate-400 font-bold">—</span>
                )}
              </span>
              <span>
                <span className="font-black uppercase text-slate-400 mr-1">ATC:</span>
                {selectedBid.buyerAddedBidSpecificAtcUrl ? (
                  <a href={selectedBid.buyerAddedBidSpecificAtcUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline font-bold">
                    Link
                  </a>
                ) : (
                  <span className="text-slate-400 font-bold">—</span>
                )}
              </span>
              <span>
                <span className="font-black uppercase text-slate-400 mr-1">Specification:</span>
                {hasSpecDocument ? (
                  <button
                    type="button"
                    onClick={() => selectedBidId && openDocPreview(selectedBidId, "spec")}
                    className="text-blue-600 underline font-bold"
                  >
                    Link
                  </button>
                ) : (
                  <span className="text-slate-400 font-bold">—</span>
                )}
              </span>
              <span>
                <span className="font-black uppercase text-slate-400 mr-1">Bid To RA / RA:</span>
                <span className="font-bold text-slate-700">
                  {selectedBid.bidToRaEnabled || "—"}
                  {selectedBid.raQualificationRule ? ` / ${selectedBid.raQualificationRule}` : ""}
                </span>
              </span>
              <span>
                <span className="font-black uppercase text-slate-400 mr-1">Type of Bid:</span>
                <span className="font-bold text-slate-700">{selectedBid.typeOfBid || "—"}</span>
              </span>
              <span>
                <span className="font-black uppercase text-slate-400 mr-1">Evaluation / EMD:</span>
                <span className="font-bold text-slate-700">
                  {selectedBid.evaluationMethod || "—"}
                  {selectedBid.emdAmount ? ` / ${selectedBid.emdAmount}` : ""}
                </span>
              </span>
            </div>
          )}

          {tab === "rate" ? (
            <>
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                    <FiCheckSquare className="text-amber-600" size={14} /> Fill Rates
                  </h3>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {bidType === "regular"
                      ? "A Regular Bid (built off a catalog Item Link, no BOQ file) - add items by hand below and fill in rates. Saved rates are kept here for reopening and changing later, and also feed suggestions for the same item on other bids."
                      : "Upload the bid's BOQ Detail Document (CSV or Excel, as downloaded from GeM) to fill in rates per item, save them against this bid, and download the rate-filled file back out. Saved rates are kept here for reopening and changing later, and also feed suggestions for the same item on other bids."}
                  </p>
                </div>
                <div className="shrink-0">
                  <input
                    ref={marketResultsFileRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) importMarketResults(f);
                      e.target.value = "";
                    }}
                  />
                  <button
                    disabled={importingMarketResults}
                    onClick={() => marketResultsFileRef.current?.click()}
                    title="Import a Bid Results Excel (from the gem-result-extension) to feed real market L1 rates into suggestions below"
                    className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white font-black uppercase text-[10px] tracking-wide py-2 px-3.5 rounded-lg transition-colors"
                  >
                    <FiUploadCloud size={12} />
                    {importingMarketResults ? "Importing..." : "Import Bid Results"}
                  </button>
                </div>
              </div>
              {!selectedBidId ? (
                <div className="text-center py-10 text-slate-400 text-xs font-bold uppercase tracking-widest">
                  Select a bid above first
                </div>
              ) : (
                <div className="p-5 flex flex-col gap-3">
                  {/* Toggle + BOQ/Regular upload + Specification upload, all
                      in one wrapping row rather than four stacked blocks -
                      this whole panel used to take a lot more vertical
                      space than these few short controls actually need. */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl p-1 w-fit">
                      {(["boq", "regular"] as const).map((t) => (
                        <button
                          key={t}
                          onClick={() => setBidType(t)}
                          className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide transition-colors ${
                            bidType === t ? "bg-amber-600 text-white shadow" : "text-slate-500 hover:text-slate-800"
                          }`}
                        >
                          {t === "boq" ? "BOQ Bid" : "Regular Bid"}
                        </button>
                      ))}
                    </div>

                    {bidType === "regular" ? (
                      <>
                        <input
                          ref={regularFileRef}
                          type="file"
                          accept=".xlsx,.xls,.csv"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) importRegularExcel(f);
                            e.target.value = "";
                          }}
                        />
                        <button
                          onClick={addRegularItem}
                          className="w-fit flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-black uppercase text-[10px] tracking-wide py-2.5 px-4 rounded-lg transition-colors"
                        >
                          <FiPlus size={13} /> Add Item
                        </button>
                        <button
                          disabled={importingRegularExcel}
                          onClick={() => regularFileRef.current?.click()}
                          className="w-fit flex items-center gap-1.5 bg-slate-700 hover:bg-slate-800 disabled:opacity-40 text-white font-black uppercase text-[10px] tracking-wide py-2.5 px-4 rounded-lg transition-colors"
                        >
                          <FiUploadCloud size={13} />
                          {importingRegularExcel ? "Reading..." : "Upload Excel"}
                        </button>
                      </>
                    ) : (
                      <>
                        <input
                          ref={boqFileRef}
                          type="file"
                          accept=".xlsx,.xls,.csv"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) uploadBoqFile(f);
                            e.target.value = "";
                          }}
                        />
                        <button
                          disabled={uploadingBoq}
                          onClick={() => boqFileRef.current?.click()}
                          className="w-fit flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white font-black uppercase text-[10px] tracking-wide py-2.5 px-4 rounded-lg transition-colors"
                        >
                          <FiUploadCloud size={13} />
                          {uploadingBoq ? "Uploading..." : hasBoqDocument ? "Replace BOQ File" : "Upload BOQ File"}
                        </button>
                        {hasBoqDocument && (
                          <>
                            <span className="text-[10px] font-black uppercase text-emerald-600">✓ Loaded</span>
                            <button
                              disabled={removingDoc === "boq"}
                              onClick={() => removeDocument("boq")}
                              title="Remove this BOQ Detail Document"
                              className="flex items-center gap-1 text-[10px] font-black uppercase text-rose-600 hover:text-rose-800 disabled:opacity-40"
                            >
                              <FiTrash2 size={11} /> Remove
                            </button>
                          </>
                        )}
                      </>
                    )}

                    <span className="w-px self-stretch bg-slate-200 mx-1" />

                    <input
                      ref={specFileRef}
                      type="file"
                      accept=".pdf"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadSpecFile(f);
                        e.target.value = "";
                      }}
                    />
                    <button
                      disabled={uploadingSpec}
                      onClick={() => specFileRef.current?.click()}
                      className="w-fit flex items-center gap-1.5 bg-slate-700 hover:bg-slate-800 disabled:opacity-40 text-white font-black uppercase text-[10px] tracking-wide py-2.5 px-4 rounded-lg transition-colors"
                    >
                      <FiUploadCloud size={13} />
                      {uploadingSpec ? "Uploading..." : hasSpecDocument ? "Replace Specification Doc" : "Upload Specification Doc"}
                    </button>
                    {hasSpecDocument && (
                      <>
                        <span className="text-[10px] font-black uppercase text-emerald-600">✓ Loaded</span>
                        <button
                          disabled={removingDoc === "spec"}
                          onClick={() => removeDocument("spec")}
                          title="Remove this Specification Document"
                          className="flex items-center gap-1 text-[10px] font-black uppercase text-rose-600 hover:text-rose-800 disabled:opacity-40"
                        >
                          <FiTrash2 size={11} /> Remove
                        </button>
                      </>
                    )}
                  </div>
                  {bidType === "regular" && (
                    <p className="text-[9px] text-slate-400 -mt-2">
                      Upload Excel: same Item Number/Title/Quantity/Unit of Measure columns as a BOQ file - rows are
                      added to the list below, still fully editable.
                    </p>
                  )}

                  {boqItems.length > 0 && (
                    <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 w-fit">
                      <span className="text-[10px] font-black uppercase text-slate-500">Apply % to all items:</span>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={globalMarginPercent}
                        onChange={(e) => setGlobalMarginPercent(e.target.value)}
                        placeholder="e.g. 10"
                        className="w-20 border border-slate-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-amber-400"
                      />
                      <button
                        onClick={applyGlobalMarginPercent}
                        disabled={!globalMarginPercent.trim()}
                        className="px-3 py-1 rounded text-[10px] font-black uppercase tracking-wide bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white transition-colors"
                      >
                        Apply to All
                      </button>
                      <span className="text-[9px] text-slate-400">Each item&apos;s % can still be changed individually below.</span>
                    </div>
                  )}

                  {boqItems.length > 0 && (
                    <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl p-1 w-fit">
                      {([
                        ["all", `All (${boqItems.length})`],
                        ["pending", `Pending (${boqItems.length - boqFilledCount})`],
                        ["filled", `Filled (${boqFilledCount})`],
                      ] as const).map(([val, label]) => (
                        <button
                          key={val}
                          onClick={() => {
                            setPinnedBoqItem(null);
                            setBoqFillFilter(val);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide transition-colors ${
                            boqFillFilter === val ? "bg-amber-600 text-white shadow" : "text-slate-500 hover:text-slate-800"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}

                  {loadingBoq ? (
                    <div className="flex justify-center items-center py-10">
                      <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-amber-500"></div>
                    </div>
                  ) : boqItems.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-6">
                      {bidType === "regular"
                        ? 'No items yet - click "Add Item" above to start.'
                        : hasBoqDocument
                        ? "No items found in this BOQ."
                        : "Upload a BOQ file for this bid to fill rates."}
                    </p>
                  ) : filteredBoqItems.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-6">
                      {boqFillFilter === "filled" ? "No items filled yet." : "Every item is already filled."}
                    </p>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-black">
                            <tr>
                              <th className="py-2 px-2 text-left">#</th>
                              <th className="py-2 px-2 text-left">Item Title</th>
                              <th className="py-2 px-2 text-left">Qty</th>
                              <th className="py-2 px-2 text-left">Unit</th>
                              {bidType === "boq" && <th className="py-2 px-2 text-left">Delivery</th>}
                              <th className="py-2 px-2 text-left w-28">Base Rate</th>
                              <th className="py-2 px-2 text-left w-20">%</th>
                              <th className="py-2 px-2 text-left w-32">Rate</th>
                              <th className="py-2 px-2 text-right">Total</th>
                              {bidType === "regular" && <th className="py-2 px-2 text-center w-10"></th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {filteredBoqItems.map(({ it, idx }) => {
                              const qty = parseFloat(it.quantity) || 0;
                              const rate = parseFloat(it.rate) || 0;
                              const total = qty * rate;
                              if (bidType === "regular") {
                                return (
                                  <tr
                                  key={it.itemNumber}
                                  onFocus={() => setPinnedBoqItem(it.itemNumber)}
                                  onBlur={(e) => {
                                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPinnedBoqItem(null);
                                  }}
                                >
                                    <td className="py-2 px-2 text-slate-500">{idx + 1}</td>
                                    <td className="py-2 px-2">
                                      <input
                                        type="text"
                                        value={it.itemTitle}
                                        onChange={(e) => updateRegularItemField(it.itemNumber, "itemTitle", e.target.value)}
                                        placeholder="Item name"
                                        className="w-full min-w-[160px] border border-slate-200 rounded px-2 py-1 text-[11px] font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-400"
                                      />
                                    </td>
                                    <td className="py-2 px-2">
                                      <input
                                        type="number"
                                        step="1"
                                        min="0"
                                        value={it.quantity}
                                        onChange={(e) => updateRegularItemField(it.itemNumber, "quantity", e.target.value)}
                                        placeholder="Qty"
                                        className="w-20 border border-slate-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-amber-400"
                                      />
                                    </td>
                                    <td className="py-2 px-2">
                                      <input
                                        type="text"
                                        value={it.unit}
                                        onChange={(e) => updateRegularItemField(it.itemNumber, "unit", e.target.value)}
                                        placeholder="Unit"
                                        className="w-20 border border-slate-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-amber-400"
                                      />
                                    </td>
                                    <td className="py-2 px-2">
                                      <input
                                        type="number"
                                        step="1"
                                        min="0"
                                        value={it.baseRate}
                                        onChange={(e) => updateBoqBaseRate(it.itemNumber, e.target.value)}
                                        placeholder="Base Rate"
                                        className="w-full border border-slate-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-amber-400"
                                      />
                                      {renderPricelistRate(it)}
                                    </td>
                                    <td className="py-2 px-2">
                                      <input
                                        type="number"
                                        step="1"
                                        min="0"
                                        value={it.marginPercent}
                                        onChange={(e) => updateBoqMarginPercent(it.itemNumber, e.target.value)}
                                        placeholder="%"
                                        className="w-full border border-slate-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-amber-400"
                                      />
                                    </td>
                                    <td className="py-2 px-2">
                                      <input
                                        type="number"
                                        step="1"
                                        min="0"
                                        value={it.rate}
                                        onChange={(e) => updateBoqRate(it.itemNumber, e.target.value)}
                                        placeholder={it.suggestedRate ? `Suggested: ${it.suggestedRate}` : "Final Rate"}
                                        className="w-full border-2 border-blue-300 bg-blue-50/40 rounded px-2 py-1 text-[11px] font-bold text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                                      />
                                      {it.suggestedRate && (
                                        <button
                                          type="button"
                                          onClick={() => updateBoqRate(it.itemNumber, it.suggestedRate)}
                                          className="text-[9px] text-amber-700 underline mt-0.5 block"
                                          title={it.suggestedFromBidNo ? `From ${it.suggestedFromBidNo}` : undefined}
                                        >
                                          Use {it.suggestedRate}
                                        </button>
                                      )}
                                      {renderMarketRateSuggestion(it)}
                                    </td>
                                    <td className="py-2 px-2 text-right font-bold text-slate-700 whitespace-nowrap">
                                      {total ? total.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
                                    </td>
                                    <td className="py-2 px-2 text-center">
                                      <button
                                        type="button"
                                        onClick={() => removeRegularItem(it.itemNumber)}
                                        className="text-slate-400 hover:text-rose-600 transition-colors"
                                        title="Remove item"
                                      >
                                        <FiTrash2 size={13} />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              }
                              return (
                                <tr
                                  key={it.itemNumber}
                                  onFocus={() => setPinnedBoqItem(it.itemNumber)}
                                  onBlur={(e) => {
                                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPinnedBoqItem(null);
                                  }}
                                >
                                  <td className="py-2 px-2 text-slate-500">{it.itemNumber}</td>
                                  <td className="py-2 px-2 max-w-[260px]" title={it.itemDescription}>
                                    <div className="font-bold text-slate-700">{it.itemTitle}</div>
                                    {it.specification && (
                                      <div className="text-[10px] font-normal text-slate-400 mt-0.5">{it.specification}</div>
                                    )}
                                  </td>
                                  <td className="py-2 px-2 text-slate-500 whitespace-nowrap">{it.quantity}</td>
                                  <td className="py-2 px-2 text-slate-500 whitespace-nowrap">{it.unit}</td>
                                  <td className="py-2 px-2 text-slate-500 whitespace-nowrap">{it.deliveryPeriod}d</td>
                                  <td className="py-2 px-2">
                                    <input
                                      type="number"
                                      step="1"
                                      min="0"
                                      value={it.baseRate}
                                      onChange={(e) => updateBoqBaseRate(it.itemNumber, e.target.value)}
                                      placeholder="Base Rate"
                                      className="w-full border border-slate-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-amber-400"
                                    />
                                    {renderPricelistRate(it)}
                                  </td>
                                  <td className="py-2 px-2">
                                    <input
                                      type="number"
                                      step="1"
                                      min="0"
                                      value={it.marginPercent}
                                      onChange={(e) => updateBoqMarginPercent(it.itemNumber, e.target.value)}
                                      placeholder="%"
                                      className="w-full border border-slate-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-amber-400"
                                    />
                                  </td>
                                  <td className="py-2 px-2">
                                    <input
                                      type="number"
                                      step="1"
                                      min="0"
                                      value={it.rate}
                                      onChange={(e) => updateBoqRate(it.itemNumber, e.target.value)}
                                      placeholder={it.suggestedRate ? `Suggested: ${it.suggestedRate}` : "Final Rate"}
                                      className="w-full border-2 border-blue-300 bg-blue-50/40 rounded px-2 py-1 text-[11px] font-bold text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                                    />
                                    {it.suggestedRate && (
                                      <button
                                        type="button"
                                        onClick={() => updateBoqRate(it.itemNumber, it.suggestedRate)}
                                        className="text-[9px] text-amber-700 underline mt-0.5 block"
                                        title={it.suggestedFromBidNo ? `From ${it.suggestedFromBidNo}` : undefined}
                                      >
                                        Use {it.suggestedRate}
                                      </button>
                                    )}
                                    {renderMarketRateSuggestion(it)}
                                  </td>
                                  <td className="py-2 px-2 text-right font-bold text-slate-700 whitespace-nowrap">
                                    {total ? total.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-slate-800">
                              <td
                                colSpan={bidType === "regular" ? 7 : 8}
                                className="py-2 px-2 text-right font-black uppercase text-[10px] text-slate-700"
                              >
                                Grand Total
                              </td>
                              <td className="py-2 px-2 text-right font-black text-slate-900 whitespace-nowrap">
                                {boqGrandTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                              </td>
                              {bidType === "regular" && <td></td>}
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 justify-end pt-2 border-t border-slate-100">
                        {boqExportUrl && (
                          <a href={boqExportUrl} target="_blank" rel="noreferrer" className="text-[11px] text-emerald-700 underline font-bold mr-auto">
                            Download ready
                          </a>
                        )}
                        {bidType === "boq" && (
                          <button
                            onClick={exportBoq}
                            disabled={boqItems.length === 0}
                            className="px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wide bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 transition-colors"
                          >
                            Download Filled BOQ
                          </button>
                        )}
                        <button
                          onClick={saveBoqRates}
                          disabled={savingBoq || boqItems.length === 0}
                          className="px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wide bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white transition-colors"
                        >
                          {savingBoq ? "Saving..." : "Save Rates"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {selectedBidId && boqItems.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                    <FiPercent className="text-purple-600" size={14} /> Rate Variants
                  </h3>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Generates 2 or 3 alternate rate columns from whatever&apos;s currently filled in the Rate column
                    above, each nudged up or down by a random amount sized to the rate itself (small items get a
                    small difference, big-ticket items a bigger one) - same approach as the standalone{" "}
                    <Link href="/dashboard/gem-bids/rate-variant-tool" target="_blank" className="underline">
                      Rate Variant Tool
                    </Link>
                    , just run directly on this bid&apos;s own items.
                  </p>
                </div>
                <div className="p-5 flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl p-1">
                      {([2, 3] as const).map((n) => (
                        <button
                          key={n}
                          onClick={() => setVariantCount(n)}
                          className={`px-4 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wide transition-colors ${
                            variantCount === n ? "bg-purple-600 text-white shadow" : "text-slate-500 hover:text-slate-800"
                          }`}
                        >
                          {n} Variants
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={generateRateVariants}
                      className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white font-black uppercase text-[10px] tracking-wide py-2 px-4 rounded-lg transition-colors"
                    >
                      <FiPercent size={12} /> {rateVariants ? "Re-roll" : "Generate Variants"}
                    </button>
                  </div>

                  {rateVariants && (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-black">
                            <tr>
                              <th className="py-2 px-2 text-left">Item Title</th>
                              <th className="py-2 px-2 text-right">Qty</th>
                              <th className="py-2 px-2 text-right">Rate</th>
                              {Array.from({ length: variantCount }, (_, i) => (
                                <th key={i} className="py-2 px-2 text-right">
                                  Variant {i + 1}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {rateVariants.map((r) => (
                              <tr key={r.itemNumber}>
                                <td className="py-2 px-2 font-bold text-slate-700 max-w-[260px] truncate" title={r.itemTitle}>
                                  {r.itemTitle}
                                </td>
                                <td className="py-2 px-2 text-right text-slate-500 whitespace-nowrap">{r.qty}</td>
                                <td className="py-2 px-2 text-right text-slate-700 whitespace-nowrap">{r.baseRate || "—"}</td>
                                {r.variants.map((v, i) => (
                                  <td key={i} className="py-2 px-2 text-right whitespace-nowrap">
                                    {v.rate ? (
                                      <>
                                        <span className="font-bold text-slate-700">{v.rate}</span>{" "}
                                        <span className={v.diff >= 0 ? "text-emerald-600" : "text-rose-600"}>
                                          ({v.diff >= 0 ? "+" : ""}
                                          {v.diff})
                                        </span>
                                      </>
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-slate-800">
                              <td colSpan={3} className="py-2 px-2 text-right font-black uppercase text-[10px] text-slate-700">
                                Grand Total ({boqGrandTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })})
                              </td>
                              {rateVariantGrandTotals.map((t, i) => (
                                <td key={i} className="py-2 px-2 text-right font-black text-slate-900 whitespace-nowrap">
                                  {t.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                                </td>
                              ))}
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                      <button
                        onClick={downloadRateVariants}
                        className="w-fit px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wide bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                      >
                        Download Excel
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {selectedBidId && boqItems.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                    <FiPercent className="text-purple-600" size={14} /> BOQ Rate Variants
                  </h3>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Builds a GeM-ready BOQ-Filled file (VARIANT 1/2/3 columns, color-coded exactly like GeM&apos;s own
                    L1/L2/L3) plus one gem-offer-price-items upload file per variant, ready to download together.
                    Variant 1 (L1) is always exactly your filled Rate column; L2/L3 are each L1&apos;s own rate plus
                    the percent set below, so the grand total always comes out L1 &lt; L2
                    {boqVariantCount === 3 ? " < L3" : ""} - L1 wins, every time.
                  </p>
                </div>
                <div className="p-5 flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl p-1">
                      {([2, 3] as const).map((n) => (
                        <button
                          key={n}
                          onClick={() => setBoqVariantCount(n)}
                          className={`px-4 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wide transition-colors ${
                            boqVariantCount === n ? "bg-purple-600 text-white shadow" : "text-slate-500 hover:text-slate-800"
                          }`}
                        >
                          {n} Variants
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded text-white"
                        style={{ backgroundColor: `#${BOQ_VARIANT_COLORS[1]}` }}
                      >
                        L2 = L1 +
                      </span>
                      <input
                        type="number"
                        step="0.01"
                        value={boqVariantL2Percent}
                        onChange={(e) => setBoqVariantL2Percent(e.target.value)}
                        className="w-16 border border-slate-200 rounded px-2 py-1 text-[10px] text-right focus:outline-none focus:ring-1 focus:ring-purple-400"
                      />
                      <span className="text-[10px] text-slate-400">%</span>
                    </div>
                    {boqVariantCount === 3 && (
                      <div className="flex items-center gap-1.5">
                        <span
                          className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded text-white"
                          style={{ backgroundColor: `#${BOQ_VARIANT_COLORS[2]}` }}
                        >
                          L3 = L1 +
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          value={boqVariantL3Percent}
                          onChange={(e) => setBoqVariantL3Percent(e.target.value)}
                          className="w-16 border border-slate-200 rounded px-2 py-1 text-[10px] text-right focus:outline-none focus:ring-1 focus:ring-purple-400"
                        />
                        <span className="text-[10px] text-slate-400">%</span>
                      </div>
                    )}
                    <button
                      onClick={generateBoqRateVariants}
                      className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white font-black uppercase text-[10px] tracking-wide py-2 px-4 rounded-lg transition-colors"
                    >
                      <FiPercent size={12} /> {boqRateVariants ? "Regenerate" : "Generate BOQ Rate Variants"}
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {Array.from({ length: boqVariantCount }, (_, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <span
                          className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded text-white"
                          style={{ backgroundColor: `#${BOQ_VARIANT_COLORS[i]}` }}
                        >
                          L{i + 1} Party
                        </span>
                        <select
                          value={boqVariantParties[i + 1] || ""}
                          onChange={(e) => setBoqVariantParties((p) => ({ ...p, [i + 1]: e.target.value }))}
                          className="border border-slate-200 rounded px-2 py-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-purple-400"
                        >
                          <option value="">Select party...</option>
                          {companies.map((c) => (
                            <option key={c._id} value={c._id}>
                              {c.firmCode ? `${c.firmCode} - ${c.firmName}` : c.firmName}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                    <span className="text-[9px] text-slate-400">
                      Which real GeM seller account to upload each variant under - its short name (firm code) also
                      goes into that variant&apos;s gem-offer-price-items file name.
                    </span>
                  </div>

                  {boqRateVariants && (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="text-[10px] font-black uppercase">
                            <tr className="bg-slate-50 text-slate-500">
                              <th className="py-2 px-2 text-left">Item Title</th>
                              <th className="py-2 px-2 text-right">Qty</th>
                              <th className="py-2 px-2 text-right">Rate</th>
                              {Array.from({ length: boqVariantCount }, (_, i) => (
                                <th
                                  key={i}
                                  colSpan={2}
                                  className="py-2 px-2 text-right text-white"
                                  style={{ backgroundColor: `#${BOQ_VARIANT_COLORS[i]}` }}
                                >
                                  VARIANT {i + 1} (L{i + 1})
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {boqRateVariants.map((r) => (
                              <tr key={r.itemNumber}>
                                <td className="py-2 px-2 font-bold text-slate-700 max-w-[260px] truncate" title={r.itemTitle}>
                                  {r.itemTitle}
                                </td>
                                <td className="py-2 px-2 text-right text-slate-500 whitespace-nowrap">{r.quantity}</td>
                                <td className="py-2 px-2 text-right text-slate-700 whitespace-nowrap">{r.rate || "—"}</td>
                                {r.variants.map((v, i) => (
                                  <td
                                    key={i}
                                    colSpan={2}
                                    className="py-2 px-2 text-right whitespace-nowrap"
                                    style={{ backgroundColor: `#${BOQ_VARIANT_COLORS[i]}22` }}
                                  >
                                    <span className="font-bold text-slate-700">{v.rate || "—"}</span>{" "}
                                    <span className="text-slate-400">({v.total.toLocaleString("en-IN", { maximumFractionDigits: 2 })})</span>
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-slate-800">
                              <td colSpan={3} className="py-2 px-2 text-right font-black uppercase text-[10px] text-slate-700">
                                Grand Total
                              </td>
                              {boqVariantGrandTotals.map((t, i) => (
                                <td
                                  key={i}
                                  colSpan={2}
                                  className="py-2 px-2 text-right font-black text-slate-900 whitespace-nowrap"
                                  style={{ backgroundColor: `#${BOQ_VARIANT_COLORS[i]}22` }}
                                >
                                  {t.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                                </td>
                              ))}
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                      <button
                        disabled={downloadingBoqVariants}
                        onClick={downloadBoqRateVariants}
                        className="w-fit flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wide bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white transition-colors"
                      >
                        <FiDownload size={12} />
                        {downloadingBoqVariants ? "Building..." : "Download BOQ-Filled + Offer Price Files (ZIP)"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
            </>
          ) : tab === "variant" ? (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden" style={{ minHeight: "80vh" }}>
              <iframe
                src="/tools/rate-variant-tool.html"
                title="Rate Variant Tool"
                className="w-full h-full border-0"
                style={{ minHeight: "80vh" }}
              />
            </div>
          ) : !firmId ? (
            <div className="text-center py-16 text-slate-400 text-xs font-bold uppercase tracking-widest">
              Select a firm to continue
            </div>
          ) : vaultLoading ? (
            <div className="flex justify-center items-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-blue-500"></div>
            </div>
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
                    Upload documents in the Document Vault first
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
                  {!selectedBidId ? (
                    <p className="text-xs text-slate-400 text-center py-4">Select a bid above first</p>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2 text-[10px] font-bold">
                        <span className={hasBidDocument ? "text-emerald-600" : "text-slate-400"}>
                          {hasBidDocument ? "✓ Bid Document fetched" : "— Bid Document not fetched yet"}
                        </span>
                        <span className={hasAtcDocument ? "text-emerald-600" : "text-slate-400"}>
                          {hasAtcDocument ? "✓ ATC Link document fetched" : "— ATC Link document not fetched yet"}
                        </span>
                        <span className={hasBoqDocument ? "text-emerald-600" : "text-slate-400"}>
                          {hasBoqDocument ? "✓ BOQ Detail Document loaded (fill rates in the Rate tab)" : "— BOQ Detail Document not loaded yet"}
                        </span>
                      </div>

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
                    </>
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
                    checked above, split at 99 pages/9.5MB into ATC_ALL_, ATC_ALL_2, ...). Uses the bid selected above.
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

      {vaultModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10 gap-3">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                  <FiFolder className="text-slate-700" size={14} /> Document Vault
                </h3>
                <select
                  value={firmId}
                  onChange={(e) => setFirmId(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-2.5 text-xs text-slate-700 focus:outline-none focus:border-blue-500 font-bold min-w-[180px]"
                >
                  <option value="">Select Firm...</option>
                  {companies.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.firmName} {c.firmCode ? `(${c.firmCode})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <button onClick={() => setVaultModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <FiX size={18} />
              </button>
            </div>
            <div className="p-5 flex flex-col gap-6">
              {!firmId ? (
                <div className="text-center py-16 text-slate-400 text-xs font-bold uppercase tracking-widest">
                  Select a firm to continue
                </div>
              ) : vaultLoading ? (
                <div className="flex justify-center items-center py-12">
                  <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-blue-500"></div>
                </div>
              ) : (
                <>
                  {/* Fixed slots: Letterhead, Sign, Stamp */}
                  <div>
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
                  <div className="border border-slate-200 rounded-2xl overflow-hidden">
                    <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-2 justify-between">
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
              )}
            </div>
          </div>
        </div>
      )}
    </BlockGuard>
  );
}

export default function DocumentMakerPage() {
  return (
    <Suspense fallback={<div className="p-4 md:p-8 bg-slate-50 min-h-screen" />}>
      <DocumentMakerPageInner />
    </Suspense>
  );
}

// Combobox (search box + dropdown list, both in one control) for picking a
// bid - replaces a free-standing search <input> that only filtered a
// separate <select> next to it, which left "how do I change this" and
// "where did my search go" unclear since the two never visibly agreed with
// each other. Same open/search/click-outside-to-close shape as
// GemBidTable's PartySelect, single-select instead of multi, plus arrow-
// key/Enter navigation (a mouse-only list after typing a search felt half
// finished) and each row led with its matched institute name (not just Bid
// No + item) since that's usually the thing actually being searched for.
function BidCombobox({
  bids,
  matchedInstituteById,
  value,
  onChange,
}: {
  bids: GemBid[];
  matchedInstituteById: Map<string, string>;
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const selectedBid = bids.find((b) => b._id === value) || null;
  const selectedInstitute = selectedBid ? matchedInstituteById.get(selectedBid._id) : null;
  const query = search.trim().toLowerCase();
  const filtered = (
    query
      ? bids.filter(
          (b) =>
            b.bidNo.toLowerCase().includes(query) ||
            (b.items || "").toLowerCase().includes(query) ||
            (matchedInstituteById.get(b._id) || "").toLowerCase().includes(query)
        )
      : bids
  ).slice(0, 50);

  useEffect(() => {
    setHighlighted(0);
  }, [search, open]);

  useEffect(() => {
    itemRefs.current[highlighted]?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  const pick = (b: GemBid) => {
    onChange(b._id);
    setOpen(false);
    setSearch("");
  };

  const rowLabel = (b: GemBid) => {
    const inst = matchedInstituteById.get(b._id);
    const parts = [inst, b.bidNo].filter(Boolean);
    return { lead: parts.join(" — "), items: b.items };
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setSearch("");
        }}
        className="bg-slate-50 border border-slate-200 rounded-lg py-2 px-2.5 text-xs font-bold text-left focus:outline-none focus:border-blue-500 flex-1 min-w-[220px] max-w-sm truncate"
      >
        {selectedBid ? (
          <>
            {selectedInstitute ? `${selectedInstitute} — ` : ""}
            {selectedBid.bidNo}
            {selectedBid.items ? ` — ${selectedBid.items.slice(0, 40)}` : ""}
          </>
        ) : (
          <span className="text-slate-400 font-normal">Select Bid...</span>
        )}
      </button>
      {open && (
        <div className="absolute z-40 top-full left-0 mt-1 w-96 bg-white border border-slate-200 rounded-lg shadow-lg p-2">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Institute, Bid No or Item..."
            className="w-full border border-slate-200 rounded px-2 py-1.5 text-[11px] mb-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlighted((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlighted((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const b = filtered[highlighted];
                if (b) pick(b);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
          />
          <div className="max-h-64 overflow-y-auto flex flex-col gap-0.5">
            {filtered.length === 0 ? (
              <span className="text-[10px] text-slate-400 px-1 py-1.5 block">No match</span>
            ) : (
              filtered.map((b, i) => {
                const { lead, items } = rowLabel(b);
                return (
                  <button
                    type="button"
                    key={b._id}
                    ref={(el) => {
                      itemRefs.current[i] = el;
                    }}
                    onMouseEnter={() => setHighlighted(i)}
                    onClick={() => pick(b)}
                    className={`text-left px-2 py-1.5 rounded text-[11px] transition-colors ${
                      i === highlighted ? "bg-blue-100" : b._id === value ? "bg-blue-50" : ""
                    }`}
                  >
                    <div className={`font-bold ${b._id === value ? "text-blue-700" : "text-slate-700"}`}>{lead}</div>
                    {items && <div className="text-[10px] text-slate-400 truncate">{items}</div>}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
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
