import XLSX from "xlsx-js-style";

export interface BoqItem {
  itemNumber: string;
  itemTitle: string;
  itemDescription: string;
  quantity: string;
  unit: string;
  consigneeId: string;
  deliveryPeriod: string;
}

// GeM's BOQ Detail Document download has no Rate column at all - that's
// the one thing the seller is meant to add before re-submitting. A couple
// of header spellings are tolerated per field since this is matched
// against a real downloaded file, not a fixed template.
const COLUMN_ALIASES: Record<keyof BoqItem, string[]> = {
  itemNumber: ["Item Number"],
  itemTitle: ["Item Title"],
  itemDescription: ["Item Description"],
  quantity: ["Item Quantity", "Quantity"],
  unit: ["Unit of Measure", "UOM"],
  consigneeId: ["Consignee ID"],
  deliveryPeriod: ["Delivery Period (In number of days)", "Delivery Period"],
};

function pick(row: Record<string, any>, aliases: string[]): string {
  for (const key of aliases) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return String(row[key]).trim();
    }
  }
  return "";
}

// Split out from parseBoqXlsx below so a Regular Bid's "Upload Excel"
// import (see app/dashboard/gem-bids/document-maker/page.tsx) can reuse the
// exact same column-matching, from rows it already parsed itself - GeM's
// own "export items" download (what that button is for) uses this same
// Item Number/Title/Description/Quantity/Unit of Measure/Consignee
// ID/Delivery Period column set, just without a Rate column either, same
// as a BOQ Detail Document. parseBoqXlsx reads with XLSX's Node Buffer
// "buffer" type (server-side fetch-and-parse); a client-side File read
// comes in as an ArrayBuffer under XLSX's "array" type instead, so the
// sheet_to_json → column-matching step is the only part shareable.
export function mapRowsToBoqItems(rows: Record<string, any>[]): BoqItem[] {
  return rows
    .map((row) => ({
      itemNumber: pick(row, COLUMN_ALIASES.itemNumber),
      itemTitle: pick(row, COLUMN_ALIASES.itemTitle),
      itemDescription: pick(row, COLUMN_ALIASES.itemDescription),
      quantity: pick(row, COLUMN_ALIASES.quantity),
      unit: pick(row, COLUMN_ALIASES.unit),
      consigneeId: pick(row, COLUMN_ALIASES.consigneeId),
      deliveryPeriod: pick(row, COLUMN_ALIASES.deliveryPeriod),
    }))
    .filter((item) => item.itemNumber || item.itemTitle);
}

/** Parses a fetched BOQ Detail Document (see app/api/gem-bids/fetch-documents) into its line items. */
export function parseBoqXlsx(buffer: Buffer): BoqItem[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const worksheet = workbook.Sheets[sheetName];
  const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
  return mapRowsToBoqItems(rows);
}

/**
 * Normalizes an item title for rate-history lookups/keys - lowercase,
 * collapsed whitespace, trimmed. Exact-ish matching rather than fuzzy: GeM
 * item titles for the same real item tend to come through near-identical
 * (sometimes letter-for-letter) across different bids, so a straight
 * normalized-equality key is enough without needing substring/fuzzy scoring
 * the way the institute-address matcher does for much more free-form text.
 */
export function normalizeItemKey(title: string): string {
  return String(title || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Rebuilds the BOQ as a downloadable .xlsx with the user's filled Rate column appended - same column set as the source file, plus Rate. */
export function buildFilledBoqXlsx(items: (BoqItem & { rate?: string })[]): Buffer {
  const rows = items.map((it) => ({
    "Item Number": it.itemNumber,
    "Item Title": it.itemTitle,
    "Item Description": it.itemDescription,
    "Item Quantity": it.quantity,
    "Unit of Measure": it.unit,
    "Consignee ID": it.consigneeId,
    "Delivery Period (In number of days)": it.deliveryPeriod,
    Rate: it.rate || "",
  }));
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "BOQ");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
