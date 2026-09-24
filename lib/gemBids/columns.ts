// Shared column/field metadata for the GeM Bids module — safe to import from both
// client components (table rendering, xlsx header matching) and server routes
// (diff engine field list). Single source of truth for the 17-column schema.

export type FilterType = "text" | "dateRange" | "dropdown";

export interface BidColumn {
  key: string;
  header: string; // display label shown in the table header (not necessarily the extension's raw export header text — see buyerAddedBidSpecificAtcUrl)
  filterType: FilterType;
  // True for a field that's still scraped/stored/diffed/editable as normal,
  // just not rendered as its own table column — either dropped from view
  // entirely (startDate) or folded into another column's cell instead
  // (address/departmentNameAndAddress render stacked inside one merged
  // "Address" column — see GemBidTable.tsx's ADDRESS_DEPARTMENT_KEY).
  hiddenInTable?: boolean;
}

// Display/table order (Bid No first — pinned, key column; Tag renders even
// further left, before Bid No, per the table component).
// "Document required from seller" is kept as the last column (wasn't in the
// originally requested sequence, but dropping a stored/diffed field
// silently seemed worse than just placing it last).
export const BID_COLUMNS: BidColumn[] = [
  { key: "bidNo", header: "Bid No", filterType: "text" },
  { key: "bidLink", header: "Bid Link", filterType: "text" },
  { key: "startDate", header: "Start Date", filterType: "dateRange", hiddenInTable: true },
  { key: "bidEndDateTime", header: "Bid End Date/Time", filterType: "dateRange" },
  // Folded into the Address column's cell (stacked as the third line, under
  // Department) and its filter dropdown stacked into that same header cell.
  { key: "consigneeCity", header: "Consignee City", filterType: "dropdown", hiddenInTable: true },
  { key: "items", header: "Items", filterType: "text" },
  { key: "quantityListing", header: "QTY", filterType: "text" },
  { key: "address", header: "Address", filterType: "text" },
  { key: "departmentNameAndAddress", header: "Department Name And Address", filterType: "text", hiddenInTable: true },
  { key: "bidToRaEnabled", header: "BID TO RA", filterType: "dropdown" },
  // Folded into the BID TO RA column's cell (stacked below it) and its
  // filter dropdown (was a text search box, now a select - request was for
  // a scrollable pick-list instead of typing).
  { key: "raQualificationRule", header: "RA", filterType: "dropdown", hiddenInTable: true },
  { key: "typeOfBid", header: "Type of Bid", filterType: "dropdown" },
  { key: "evaluationMethod", header: "Evaluation", filterType: "dropdown" },
  // Folded into the Evaluation column's cell (stacked below it).
  { key: "emdAmount", header: "EMD Amount", filterType: "text", hiddenInTable: true },
  // Note the exact source header is "Beneficiary :" (trailing space + colon) — verified
  // against the extension's own export code, not assumed. hiddenInTable per
  // spec - still scraped/stored/diffed/editable, just not its own column.
  { key: "beneficiary", header: "Beneficiary :", filterType: "text", hiddenInTable: true },
  // Folded into the Document required from seller column's cell (stacked
  // below it, as its own hyperlink line) and filter box.
  { key: "buyerAddedBidSpecificAtcUrl", header: "ATC", filterType: "text", hiddenInTable: true },
  { key: "documentRequiredFromSeller", header: "Document required from seller", filterType: "text" },
];

// Some long/verbose scraped values are shown shortened in the table cell
// only — the full original text is untouched in storage, in the Edit Bid
// form, and in the cell's title tooltip (hover to see it in full).
export const CELL_DISPLAY_FORMATTERS: Record<string, (value: string) => string> = {
  raQualificationRule: (v) => {
    const val = (v || "").trim();
    if (!val) return val;
    const pct = val.match(/^(\d+%)/);
    if (pct) return pct[1];
    const h = val.match(/^(H\d+)\b/i);
    if (h) return h[1].toUpperCase();
    return val;
  },
  typeOfBid: (v) => {
    const val = (v || "").trim();
    if (/^two\b/i.test(val)) return "TWO";
    if (/^single\b/i.test(val)) return "SINGLE";
    return val;
  },
  evaluationMethod: (v) => {
    const val = (v || "").trim().toLowerCase();
    if (val === "total value wise evaluation") return "TOTAL";
    if (val === "item wise evaluation") return "ITEM WISE";
    return v || "";
  },
};

// Fields the Edit Bid modal offers - every data column except the identity
// key (bidNo). Editing is allowed exactly once per bid (see the PATCH
// handler in app/api/gem-bids/route.ts) - after that the button locks, so
// this isn't meant as a repeatable correction tool, just a one-time
// "fix what the scrape got wrong before this bid moves further" step.
export const EDITABLE_FIELD_KEYS = BID_COLUMNS.filter((c) => c.key !== "bidNo").map((c) => c.key);

export const DATA_FIELD_KEYS = BID_COLUMNS.filter((c) => c.key !== "bidNo").map((c) => c.key);

export const HEADER_TO_FIELD: Record<string, string> = Object.fromEntries(
  BID_COLUMNS.map((c) => [c.header, c.key])
);

export const SECTIONS = [
  { key: "new_bids", label: "New Bids" },
  { key: "fetched_bid_data", label: "Fetched Bid Data" },
  { key: "bids_can_be_filled", label: "Bids Can Be Filled" },
  { key: "bids_to_fill", label: "Bids to Fill" },
  { key: "bid_document_maker", label: "Bid Document Maker" },
  { key: "submitted_bids", label: "Submitted Bids" },
] as const;

export type SectionKey = (typeof SECTIONS)[number]["key"];
export const SECTION_KEYS = SECTIONS.map((s) => s.key) as SectionKey[];

// Sections a bid moves into automatically (New Bids on first sight) or that carry
// their own dedicated workflow (Submitted Bids status tracking) rather than being
// a free manual "Send to" target from every other section.
export const AUTO_ONLY_SECTIONS: SectionKey[] = ["new_bids"];

// Sections where an expired bid (Bid End Date/Time in the past) gets auto-deleted
// during sync - a bid that's progressed further into real work (Bids to Fill
// onward, including Submitted) is left for the user to remove manually.
export const AUTO_DELETE_EXPIRED_SECTIONS: SectionKey[] = ["new_bids", "fetched_bid_data", "bids_can_be_filled"];

export const SUBMITTED_STATUSES = [
  "Active",
  "Cancelled",
  "Technical Evaluation",
  "Financial Evaluation",
  "Awarded",
] as const;
export type SubmittedStatus = (typeof SUBMITTED_STATUSES)[number];

const HIGHLIGHT_ITEM_TERM = "paper-based printing services";
/** Mirrors the extension's own yellow-highlight rule exactly (case-insensitive substring on Items). */
export function computeHighlight(items?: string | null): boolean {
  return (items || "").toLowerCase().includes(HIGHLIGHT_ITEM_TERM);
}

// Category keywords a bid's Items text is checked against on every sync - matches
// are dropped before ever reaching gem_bids. Kept in an editable JSON file (not
// inline) per spec, so the list can be tuned without a code change/deploy.
import exclusionKeywordsRaw from "./exclusionKeywords.json";
export const EXCLUSION_KEYWORDS: string[] = exclusionKeywordsRaw as string[];

/** Case-insensitive partial match against the exclusion keyword list. */
export function isExcludedByCategory(items?: string | null): boolean {
  const text = (items || "").toLowerCase();
  if (!text) return false;
  return EXCLUSION_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
}
