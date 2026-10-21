import { NextResponse } from "next/server";
import { getPricelistDb } from "@/lib/pricelist/db";

export const runtime = "nodejs";

// GET: Tag Manager list. GET ?tag_key=: linked items of one tag (for the expanded row).
export async function GET(req: Request) {
  try {
    const { db } = await getPricelistDb();
    const tagKey = new URL(req.url).searchParams.get("tag_key");
    const tags = db.collection("pricelist_tags");
    const items = db.collection("pricelist_items");

    if (tagKey) {
      const links = await tags.find({ tag_key: tagKey }).toArray();
      const docs = await items
        .find({ sku_key: { $in: links.map((l: any) => l.sku_key) } })
        .project({ search_text: 0, price_history: 0 })
        .toArray();
      const bySku = new Map(docs.map((d: any) => [d.sku_key, d]));
      return NextResponse.json({
        links: links
          .map((l: any) => ({ id: String(l._id), item: bySku.get(l.sku_key) ? { ...bySku.get(l.sku_key), _id: String(bySku.get(l.sku_key)._id) } : { sku_key: l.sku_key } }))
          .sort((a, b) => String(a.item.sku_key).localeCompare(String(b.item.sku_key))),
      });
    }

    const all = await tags.find({}).toArray();
    const skus = Array.from(new Set(all.map((t: any) => t.sku_key)));
    const docs = await items
      .find({ sku_key: { $in: skus } })
      .project({ sku_key: 1, brand: 1, unit_price_incl_gst: 1, is_active: 1 })
      .toArray();
    const bySku = new Map(docs.map((d: any) => [d.sku_key, d]));

    const groups = new Map<string, { tag_key: string; tag_name: string; count: number; brands: Set<string>; lowest: number | null }>();
    for (const t of all as any[]) {
      let g = groups.get(t.tag_key);
      if (!g) {
        g = { tag_key: t.tag_key, tag_name: t.tag_name, count: 0, brands: new Set(), lowest: null };
        groups.set(t.tag_key, g);
      }
      g.count++;
      const it: any = bySku.get(t.sku_key);
      if (it?.brand) g.brands.add(it.brand);
      if (it?.is_active && typeof it.unit_price_incl_gst === "number") {
        g.lowest = g.lowest === null ? it.unit_price_incl_gst : Math.min(g.lowest, it.unit_price_incl_gst);
      }
    }
    const list = Array.from(groups.values())
      .map((g) => ({ ...g, brands: Array.from(g.brands).sort() }))
      .sort((a, b) => a.tag_name.localeCompare(b.tag_name));
    return NextResponse.json({ tags: list });
  } catch (error: any) {
    console.error("Pricelist tag summary error:", error);
    return NextResponse.json({ error: error.message || "Failed to load tags" }, { status: 500 });
  }
}
