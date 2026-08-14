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
  { key: "fetched_bid_data", label: "Fetched Bid Data" },
  { key: "bids_can_be_filled", label: "Bids Can Be Filled" },
  { key: "bids_to_fill", label: "Bids to Fill" },
  { key: "bid_document_maker", label: "Bid Document Maker" },
] as const;

export type SectionKey = (typeof SECTIONS)[number]["key"];
export const SECTION_KEYS = SECTIONS.map((s) => s.key) as SectionKey[];

const HIGHLIGHT_ITEM_TERM = "paper-based printing services";
/** Mirrors the extension's own yellow-highlight rule exactly (case-insensitive substring on Items). */
export function computeHighlight(items?: string | null): boolean {
  return (items || "").toLowerCase().includes(HIGHLIGHT_ITEM_TERM);
}
