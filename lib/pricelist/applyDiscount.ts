// Upload-time discount: applied to PRICED rows and the net / incl-GST values recalculated with
// the same formulas as parse.ts. Shared by the preview (client) and /commit (server).
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface DiscountableRow {
  price_status: string;
  unit_price: number | null;
  discount_pct: number;
  net_unit_price: number | null;
  gst_pct: number | null;
  gst_included: string;
  unit_price_incl_gst: number | null;
}

// overwrite=false leaves rows that already carry a discount in the file untouched.
export function applyDiscount<T extends DiscountableRow>(rows: T[], pct: number, overwrite: boolean): T[] {
  if (!(pct >= 0 && pct <= 100)) return rows;
  return rows.map((r) => {
    if (r.price_status !== "PRICED" || r.unit_price === null) return r;
    if (!overwrite && (r.discount_pct || 0) > 0) return r;
    const net = round2(r.unit_price * (1 - pct / 100));
    const incl = r.gst_included === "YES" ? net : round2(net * (1 + (r.gst_pct || 0) / 100));
    return { ...r, discount_pct: pct, net_unit_price: net, unit_price_incl_gst: incl };
  });
}
