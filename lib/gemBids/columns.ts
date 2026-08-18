// Shared column/field metadata for the GeM Bids module — safe to import from both
// client components (table rendering, xlsx header matching) and server routes
// (diff engine field list). Single source of truth for the 17-column schema.

export type FilterType = "text" | "dateRange" | "dropdown";

export interface BidColumn {
  key: string;
  header: string; // exact header text as written by the GeM Bid Exporter extension
  filterType: FilterType;
}

// Order matches the spec: Bid No first (pinned, key column), Tag rendered right after it
// by the table component, then the remaining 15 source columns in original export order.
export const BID_COLUMNS: BidColumn[] = [
  { key: "bidNo", header: "Bid No", filterType: "text" },
  { key: "consigneeCity", header: "Consignee City", filterType: "dropdown" },
  { key: "bidLink", header: "Bid Link", filterType: "text" },
  { key: "items", header: "Items", filterType: "text" },
  { key: "quantityListing", header: "Quantity (Listing)", filterType: "text" },
  { key: "departmentNameAndAddress", header: "Department Name And Address", filterType: "text" },
  { key: "startDate", header: "Start Date", filterType: "dateRange" },
  { key: "bidEndDateTime", header: "Bid End Date/Time", filterType: "dateRange" },
  { key: "documentRequiredFromSeller", header: "Document required from seller", filterType: "text" },
  { key: "bidToRaEnabled", header: "Bid to RA enabled", filterType: "dropdown" },
  { key: "raQualificationRule", header: "RA Qualification Rule", filterType: "text" },
  { key: "typeOfBid", header: "Type of Bid", filterType: "dropdown" },
  { key: "evaluationMethod", header: "Evaluation Method", filterType: "dropdown" },
  { key: "emdAmount", header: "EMD Amount", filterType: "text" },
  // Note the exact source header is "Beneficiary :" (trailing space + colon) — verified
  // against the extension's own export code, not assumed.
  { key: "beneficiary", header: "Beneficiary :", filterType: "text" },
  { key: "address", header: "Address", filterType: "text" },
  { key: "buyerAddedBidSpecificAtcUrl", header: "Buyer Added Bid Specific ATC", filterType: "text" },
];

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
