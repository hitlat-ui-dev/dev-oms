// lib/deliveryChallan.ts
//
// Server-side helpers shared by the Delivery Challan routes: turning a request
// body's loose item list into stored challan lines, snapshotting the firm and
// consignee, and mapping a stored challan onto the PDF renderer's input.
//
// Kept out of the route files so create, update, finalize and the PDF
// re-render all normalise identically - a challan edited through PATCH must
// end up shaped exactly like one created through POST.

import { DcPdfData } from "@/lib/generateDeliveryChallanPdf";
import { shortFinancialYear } from "@/lib/dcNumbering";

export interface DcLineInput {
  itemMasterId?: string | null;
  itemName?: string;
  qty?: number | string;
  unit?: string;
}

export interface DcLine {
  srNo: number;
  itemMasterId: any;
  itemName: string;
  qty: number;
  unit: string;
}

export function formatDateDDMMYYYY(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/**
 * Parses the date picker's "yyyy-mm-dd" as LOCAL midnight.
 *
 * `new Date("2026-04-01")` is UTC midnight, and every reader of that value
 * (getFinancialYear, formatDateDDMMYYYY) uses local getters - so on a host
 * behind UTC it reads back as 31 March, which would print the wrong date and,
 * on exactly that day, take the challan's number from the PREVIOUS financial
 * year's series. Building the date from its parts keeps the day the user
 * picked intact wherever this runs.
 */
export function parseFormDate(input: unknown): Date | null {
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;

  const raw = String(input ?? "").trim();
  if (!raw) return null;

  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (parts) return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));

  const parsed = new Date(raw);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Normalises the posted item list into stored challan lines: blank names are
 * dropped, Sr. No. is renumbered from 1 (the client's own numbering is never
 * trusted - rows get added, removed and reordered before save), and qty is
 * coerced to a number.
 *
 * Throws on a line whose qty isn't a positive number, since a challan line
 * with qty 0 or "abc" would print as a meaningless dispatch row.
 */
export function normaliseItems(rawItems: unknown, toObjectId: (id: string) => any): DcLine[] {
  if (!Array.isArray(rawItems)) return [];

  const lines: DcLine[] = [];
  for (const raw of rawItems as DcLineInput[]) {
    const itemName = (raw?.itemName || "").toString().trim();
    if (!itemName) continue;

    const qty = Number(raw?.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error(`Qty for "${itemName}" must be a number greater than 0.`);
    }

    const masterId = raw?.itemMasterId ? String(raw.itemMasterId) : "";
    lines.push({
      srNo: lines.length + 1,
      itemMasterId: masterId ? toObjectId(masterId) : null,
      itemName,
      qty,
      unit: (raw?.unit || "").toString().trim(),
    });
  }
  return lines;
}

export function totalQtyOf(items: DcLine[]): number {
  // Qty can be fractional (2.5 kg), and repeated float addition drifts
  // (0.1 + 0.2), so the sum is rounded back to the 3 decimals the PDF prints.
  return Number(items.reduce((sum, it) => sum + it.qty, 0).toFixed(3));
}

/** Snapshots the firm exactly as the Billing module does, so later edits to
 * the Company record never change an already-issued challan. dispatchAddress
 * is preferred because sellerRegisterAddress is often just a city name.
 *
 * Picking a firm is optional, so a null company yields an EMPTY snapshot -
 * the renderer reads the blank name as "no firm block on this challan" and
 * omits the whole header rather than printing an empty box. */
export function firmSnapshotOf(company: any) {
  if (!company) return { name: "", address: "", state: "", gstin: null, pan: null, mobile: "", contactEmail: "" };

  const address = company.dispatchAddress
    ? company.dispatchAddress
    : [company.sellerRegisterAddress, company.state].filter(Boolean).join(", ");

  return {
    name: company.firmName || "",
    address,
    state: company.state || "",
    gstin: company.gstin || null,
    pan: company.pan || null,
    mobile: company.mobile || "",
    contactEmail: company.contactEmail || "",
  };
}

/** Builds the consignee block. Everything is optional: when a seller was
 * picked its details seed the block, and any field typed over on the form wins
 * (the user may be shipping to a one-off address for a known institute). */
export function consigneeOf(body: any, seller: any, toObjectId: (id: string) => any) {
  const pick = (formValue: any, sellerValue: any) => {
    const typed = (formValue ?? "").toString().trim();
    if (typed) return typed;
    return (sellerValue ?? "").toString().trim();
  };

  const sellerId = body?.consignee?.sellerId ? String(body.consignee.sellerId) : "";

  return {
    sellerId: sellerId ? toObjectId(sellerId) : null,
    instituteName: pick(body?.consignee?.instituteName, seller?.instituteName),
    buyerName: pick(body?.consignee?.buyerName, seller?.buyerName),
    address: pick(body?.consignee?.address, seller?.address),
    place: pick(body?.consignee?.place, seller?.place),
    state: pick(body?.consignee?.state, seller?.state),
    mobile: pick(body?.consignee?.mobile, seller?.mobile),
  };
}

/** Maps a stored challan document onto the PDF renderer's input. */
export function toPdfData(dc: any): DcPdfData {
  return {
    dcNumberFormatted:
      dc.dcNumberFormatted ||
      (dc.status === "draft" ? `DRAFT/${shortFinancialYear(dc.financialYear || "")}` : ""),
    date: formatDateDDMMYYYY(new Date(dc.date)),
    // No firm name means no firm was picked - the renderer skips the entire
    // header block (and the "For <firm>" signature line) rather than drawing
    // an empty one.
    firm: dc.firmSnapshot?.name
      ? {
          name: dc.firmSnapshot.name,
          address: dc.firmSnapshot.address || "",
          mobile: dc.firmSnapshot.mobile || "",
          email: dc.firmSnapshot.contactEmail || "",
          gstin: dc.firmSnapshot.gstin || null,
          pan: dc.firmSnapshot.pan || null,
        }
      : null,
    consignee: {
      instituteName: dc.consignee?.instituteName || "",
      buyerName: dc.consignee?.buyerName || "",
      address: dc.consignee?.address || "",
      place: dc.consignee?.place || "",
      mobile: dc.consignee?.mobile || "",
    },
    items: (dc.items || []).map((it: any) => ({
      srNo: it.srNo,
      itemName: it.itemName,
      qty: it.qty,
      unit: it.unit || "",
    })),
    totalQty: dc.totalQty || 0,
    remarks: dc.remarks || "",
    isDraft: dc.status !== "finalized",
  };
}

/** Filename for a downloaded challan - the "/" in "01/26-27" is a path
 * separator, so it can never appear in one. */
export function dcFileName(dc: any): string {
  const base = dc.dcNumberFormatted ? dc.dcNumberFormatted.replace(/\//g, "-") : `DRAFT-${String(dc._id).slice(-6)}`;
  return `Delivery-Challan-${base}.pdf`;
}
