import type { Db } from "mongodb";
import type { ParsedRow } from "./parse";

export interface DiffResult {
  added: ParsedRow[];
  changed: { sku_key: string; label: string; old: number | null; new: number | null; pct: number | null }[];
  removed: { sku_key: string; label: string }[];
  unchanged: number;
  // skus whose price differs from the stored item (or are brand new) - these get a price_history push
  historySkus: Set<string>;
}

export const itemLabel = (r: { category?: string; sub_type?: string; model_no?: string; size_spec?: string; variant?: string }) =>
  [r.category, r.sub_type, r.model_no, r.size_spec, r.variant].filter(Boolean).join(" · ");

export async function diffAgainstActive(db: Db, supplierCode: string, rows: ParsedRow[]): Promise<DiffResult> {
  const existing = await db
    .collection("pricelist_items")
    .find({ supplier_code: supplierCode, is_active: true, source: { $ne: "manual" } })
    .project({ sku_key: 1, unit_price_incl_gst: 1, category: 1, sub_type: 1, model_no: 1, size_spec: 1, variant: 1 })
    .toArray();
  const oldBySku = new Map(existing.map((e: any) => [e.sku_key, e]));
  const newSkus = new Set(rows.map((r) => r.sku_key));

  const out: DiffResult = { added: [], changed: [], removed: [], unchanged: 0, historySkus: new Set() };
  for (const r of rows) {
    const old: any = oldBySku.get(r.sku_key);
    if (!old) {
      out.added.push(r);
      out.historySkus.add(r.sku_key);
    } else if ((old.unit_price_incl_gst ?? null) !== (r.unit_price_incl_gst ?? null)) {
      const o = old.unit_price_incl_gst ?? null;
      const n = r.unit_price_incl_gst ?? null;
      out.changed.push({
        sku_key: r.sku_key,
        label: itemLabel(r),
        old: o,
        new: n,
        pct: o && n !== null ? Math.round(((n - o) / o) * 10000) / 100 : null,
      });
      out.historySkus.add(r.sku_key);
    } else {
      out.unchanged++;
    }
  }
  for (const e of existing as any[]) {
    if (!newSkus.has(e.sku_key)) out.removed.push({ sku_key: e.sku_key, label: itemLabel(e) });
  }
  return out;
}
