import { NextResponse } from "next/server";
import { getPricelistDb } from "@/lib/pricelist/db";
import { normalizeName } from "@/lib/pricelist/normalize";

export const runtime = "nodejs";

// POST { names: [] } -> { rates: { [normalizedName]: [{ rate, brand, sku_key, ... }] } }
// One call per bid page (never N+1). Each list is sorted low -> high, ON_REQUEST last.
export async function POST(req: Request) {
  try {
    const { names } = await req.json();
    if (!Array.isArray(names)) return NextResponse.json({ error: "names must be an array" }, { status: 400 });
    const keys = Array.from(new Set(names.map(normalizeName).filter(Boolean)));
    if (keys.length === 0) return NextResponse.json({ rates: {} });

    const { db } = await getPricelistDb();
    const links = await db.collection("pricelist_tags").find({ tag_key: { $in: keys } }).toArray();
    if (links.length === 0) return NextResponse.json({ rates: {} });

    const items = await db
      .collection("pricelist_items")
      .find({ sku_key: { $in: Array.from(new Set(links.map((l: any) => l.sku_key))) } })
      .project({ search_text: 0, price_history: 0 })
      .toArray();
    const bySku = new Map(items.map((i: any) => [i.sku_key, i]));
    const lists = await db
      .collection("pricelists")
      .find({ _id: { $in: items.map((i: any) => i.pricelist_id) } })
      .project({ uploaded_at: 1 })
      .toArray();
    const uploadedAt = new Map(lists.map((p: any) => [String(p._id), p.uploaded_at]));

    const rates: Record<string, any[]> = {};
    for (const l of links as any[]) {
      const it: any = bySku.get(l.sku_key);
      if (!it) continue;
      (rates[l.tag_key] ||= []).push({
        sku_key: it.sku_key,
        rate: it.unit_price_incl_gst,
        brand: it.brand,
        supplier_name: it.supplier_name,
        price: it.price,
        price_qty: it.price_qty,
        discount_pct: it.discount_pct,
        gst_pct: it.gst_pct,
        gst_included: it.gst_included,
        valid_from: it.valid_from,
        price_status: it.price_status,
        is_active: it.is_active,
        uploaded_at: uploadedAt.get(String(it.pricelist_id)) || null,
      });
    }
    for (const k of Object.keys(rates)) {
      rates[k].sort((a, b) => {
        // active+priced first, then cheapest; inactive/on-request sink to the bottom
        const rank = (x: any) => (x.is_active && x.rate !== null ? 0 : x.is_active ? 1 : 2);
        return rank(a) - rank(b) || (a.rate ?? 0) - (b.rate ?? 0);
      });
    }
    return NextResponse.json({ rates });
  } catch (error: any) {
    console.error("Pricelist rates-for-names error:", error);
    return NextResponse.json({ error: error.message || "Failed to load rates" }, { status: 500 });
  }
}
