import * as XLSX from "xlsx";

export const COLUMNS = [
  "sku_key", "category", "sub_type", "model_no", "size_spec", "variant", "unit", "price", "price_qty",
  "unit_price", "discount_pct", "net_unit_price", "gst_pct", "unit_price_incl_gst", "price_type",
  "gst_included", "price_status", "pack_qty", "supplier_name", "brand", "valid_from", "source_page",
] as const;

type Col = (typeof COLUMNS)[number];

const UNITS = ["Each", "Set", "Pair", "Pack", "Kg"];
const PRICE_TYPES = ["LIST", "MRP", "DEALER", "NET"];
export const MAX_ROWS = 10000;

export interface ParsedRow {
  sku_key: string; category: string; sub_type: string; model_no: string; size_spec: string; variant: string;
  unit: string; price: number | null; price_qty: number; unit_price: number | null; discount_pct: number;
  net_unit_price: number | null; gst_pct: number | null; unit_price_incl_gst: number | null;
  price_type: string; gst_included: string; price_status: string; pack_qty: number | null;
  supplier_name: string; brand: string; valid_from: string; source_page: number | null;
  search_text: string;
}
export interface RowIssue { row: number; column: string; message: string }
export interface ParseResult {
  headerErrors: string[]; errors: RowIssue[]; warnings: RowIssue[]; rows: ParsedRow[]; totalRows: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const str = (v: any) => (v === null || v === undefined ? "" : String(v).trim());

// null = blank, NaN = not a number
function num(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/[₹,\s]/g, "");
  if (cleaned === "") return null;
  return /^-?\d*\.?\d+$/.test(cleaned) ? Number(cleaned) : NaN;
}

function toIsoDate(v: any): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    // cellDates yields UTC-midnight-ish dates; use local parts shifted by tz offset to avoid off-by-one
    const d = new Date(v.getTime() - v.getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 10);
  }
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${String(d.y).padStart(4, "0")}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

export function parsePricelist(buffer: Buffer): ParseResult {
  const result: ParseResult = { headerErrors: [], errors: [], warnings: [], rows: [], totalRows: 0 };
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch {
    result.headerErrors.push("File could not be read as .xlsx");
    return result;
  }
  const ws = wb.Sheets["Pricelist"];
  if (!ws) {
    result.headerErrors.push('Sheet "Pricelist" not found');
    return result;
  }
  const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  const header = (aoa[0] || []).map(str);
  COLUMNS.forEach((col, i) => {
    if (header[i] !== col) {
      const at = header.indexOf(col);
      result.headerErrors.push(
        at === -1
          ? `Column ${i + 1} should be "${col}" - missing (found "${header[i] || "empty"}")`
          : `Column "${col}" is at position ${at + 1}, expected position ${i + 1}`
      );
    }
  });
  if (header.length > COLUMNS.length && header.slice(COLUMNS.length).some(Boolean)) {
    result.headerErrors.push(
      `Unexpected extra columns after column ${COLUMNS.length}: ${header.slice(COLUMNS.length).filter(Boolean).join(", ")}`
    );
  }
  if (result.headerErrors.length) return result;

  const dataRows = aoa
    .slice(1)
    .map((r, i) => ({ r, n: i + 2 }))
    .filter(({ r }) => r.some((c) => c !== null && str(c) !== ""));
  result.totalRows = dataRows.length;
  if (dataRows.length > MAX_ROWS) {
    result.errors.push({ row: 0, column: "", message: `Too many rows (${dataRows.length}); max ${MAX_ROWS}` });
    return result;
  }

  const seen = new Map<string, number>();
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  let blankGst = 0;

  for (const { r, n } of dataRows) {
    const errCountBefore = result.errors.length;
    const err = (column: string, message: string) => result.errors.push({ row: n, column, message });
    const g = (col: Col) => r[COLUMNS.indexOf(col)];

    const sku = str(g("sku_key"));
    if (!sku) err("sku_key", "Required");
    else if (seen.has(sku)) err("sku_key", `Duplicate of row ${seen.get(sku)}`);
    else seen.set(sku, n);

    const category = str(g("category"));
    if (!category) err("category", "Required");
    const unit = str(g("unit"));
    if (!UNITS.includes(unit)) err("unit", `Must be one of ${UNITS.join(", ")}`);
    const priceType = str(g("price_type")).toUpperCase();
    if (!PRICE_TYPES.includes(priceType)) err("price_type", `Must be one of ${PRICE_TYPES.join(", ")}`);
    const gstIncluded = str(g("gst_included")).toUpperCase();
    if (!["YES", "NO"].includes(gstIncluded)) err("gst_included", "Must be YES or NO");
    const priceStatus = str(g("price_status")).toUpperCase();
    if (!["PRICED", "ON_REQUEST"].includes(priceStatus)) err("price_status", "Must be PRICED or ON_REQUEST");
    const onRequest = priceStatus === "ON_REQUEST";
    const supplier = str(g("supplier_name"));
    if (!supplier) err("supplier_name", "Required");

    const validFrom = toIsoDate(g("valid_from"));
    if (!validFrom) err("valid_from", "Required, format YYYY-MM-DD");
    else if (new Date(validFrom) < twoYearsAgo) {
      result.warnings.push({ row: n, column: "valid_from", message: `Older than 2 years (${validFrom})` });
    }

    const price = num(g("price"));
    if (price !== null && Number.isNaN(price)) err("price", "Not a number");
    else if (price === null && !onRequest) err("price", "Required unless price_status is ON_REQUEST");
    else if (price !== null && price < 0) err("price", "Must be >= 0");

    let priceQty = num(g("price_qty"));
    if (priceQty === null) priceQty = 1;
    if (Number.isNaN(priceQty) || priceQty <= 0) err("price_qty", "Must be a number > 0");

    let discount = num(g("discount_pct"));
    if (discount === null) discount = 0;
    if (Number.isNaN(discount) || discount < 0 || discount > 100) err("discount_pct", "Must be 0-100");

    const gst = num(g("gst_pct"));
    if (gst !== null && (Number.isNaN(gst) || gst < 0)) err("gst_pct", "Must be a number >= 0");
    else if (gst === null) {
      blankGst++;
      if (!onRequest) err("gst_pct", "Required");
    }
    const packQty = num(g("pack_qty"));
    if (packQty !== null && Number.isNaN(packQty)) err("pack_qty", "Not a number");
    const srcPage = num(g("source_page"));
    if (srcPage !== null && Number.isNaN(srcPage)) err("source_page", "Not a number");

    if (result.errors.length > errCountBefore) continue;

    let unitPrice: number | null = null;
    let net: number | null = null;
    let incl: number | null = null;
    let finalPrice: number | null = null;
    if (!onRequest && price !== null) {
      finalPrice = price;
      unitPrice = round2(price / priceQty);
      net = round2(unitPrice * (1 - discount / 100));
      incl = gstIncluded === "YES" ? net : round2(net * (1 + (gst || 0) / 100));
    }
    const row: ParsedRow = {
      sku_key: sku, category, sub_type: str(g("sub_type")), model_no: str(g("model_no")), size_spec: str(g("size_spec")),
      variant: str(g("variant")), unit, price: finalPrice, price_qty: priceQty, unit_price: unitPrice,
      discount_pct: discount, net_unit_price: net, gst_pct: gst, unit_price_incl_gst: incl,
      price_type: priceType, gst_included: gstIncluded, price_status: priceStatus, pack_qty: packQty,
      supplier_name: supplier, brand: str(g("brand")), valid_from: validFrom as string, source_page: srcPage,
      search_text: "",
    };
    row.search_text = [row.sku_key, row.category, row.sub_type, row.model_no, row.size_spec, row.variant, row.brand, row.supplier_name]
      .join(" ")
      .toLowerCase();
    result.rows.push(row);
  }
  if (blankGst) result.warnings.push({ row: 0, column: "gst_pct", message: `${blankGst} row(s) have blank gst_pct` });
  const onReq = result.rows.filter((x) => x.price_status === "ON_REQUEST").length;
  if (onReq) result.warnings.push({ row: 0, column: "price_status", message: `${onReq} row(s) are ON_REQUEST` });
  return result;
}

export function supplierCodeOf(sku: string) {
  return sku.split("-")[0].trim().toUpperCase();
}
