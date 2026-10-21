import XLSX from "xlsx-js-style";
import { normalizeItemKey } from "./boqEngine";

export interface MarketRateRow {
  itemKey: string;
  itemTitle: string;
  l1Rate: number;
  l1Party: string;
  diffPercent: number;
}

export interface MarketRateSummary {
  bidNo: string;
  // "ITEM_WISE" or "TOTAL", straight from the Summary sheet's own
  // "Evaluation" row - which kind of evaluation this bid's result page
  // used (per-item L1 vs total-value L1), shown alongside each hover-table
  // row by request so a trend across bids with different evaluation modes
  // isn't read as directly comparable without that context.
  evaluationType: string;
}

/** Reads the Summary sheet's "Bid No" and "Evaluation" rows, so an import can be tagged with (and deduped by) which bid it came from and how that bid was evaluated. */
export function parseMarketRateSummary(buffer: Buffer): MarketRateSummary {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames.find((n) => n.toLowerCase() === "summary");
  if (!sheetName) return { bidNo: "", evaluationType: "" };
  const rows: any[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
  const get = (label: string) => {
    const row = rows.find((r) => String(r[0] || "").trim().toLowerCase() === label);
    return row ? String(row[1] || "").trim() : "";
  };
  return { bidNo: get("bid no"), evaluationType: get("evaluation") };
}

// Parses the "Rates" sheet of a Bid Results Excel exported by the user's
// own separate "gem-result-extension" (scrapes a bid's RA/evaluation
// result page on GeM - who actually won each item and at what rate - and
// exports it this way; not something this project generates itself).
// Column set is fixed by that extension: Sr No | Item Name | Qty | Hamara
// Rate | L1 Rate | Difference % | L1 Party. A "Schedule N" placeholder row
// (an item whose evaluation was still in progress when the extension ran,
// so it has no real L1 Rate yet) and any row missing a usable L1 Rate are
// both skipped - there's nothing to learn from either.
export function parseMarketRateXlsx(buffer: Buffer): MarketRateRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames.find((n) => n.toLowerCase() === "rates") || workbook.SheetNames[0];
  if (!sheetName) return [];
  const worksheet = workbook.Sheets[sheetName];
  const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

  return rows
    .map((row) => {
      const itemTitle = String(row["Item Name"] || "").trim();
      const l1Rate = parseFloat(row["L1 Rate"]);
      const l1Party = String(row["L1 Party"] || "").trim();
      const diffPercent = parseFloat(row["Difference %"]);
      return { itemKey: normalizeItemKey(itemTitle), itemTitle, l1Rate, l1Party, diffPercent };
    })
    .filter((r) => r.itemTitle && Number.isFinite(r.l1Rate) && r.l1Rate > 0);
}
