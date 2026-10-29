import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
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
      .project({ sku_key: 1, brand: 1, supplier_name: 1, unit_price_incl_gst: 1, is_active: 1 })
      .toArray();
    const bySku = new Map(docs.map((d: any) => [d.sku_key, d]));

    const groups = new Map<string, { tag_key: string; tag_name: string; count: number; brands: Set<string>; lowest: number | null; offers: { supplier: string; brand: string; rate: number; source?: string }[] }>();
    for (const t of all as any[]) {
      let g = groups.get(t.tag_key);
      if (!g) {
        g = { tag_key: t.tag_key, tag_name: t.tag_name, count: 0, brands: new Set(), lowest: null, offers: [] };
        groups.set(t.tag_key, g);
      }
      g.count++;
      const it: any = bySku.get(t.sku_key);
      if (it?.brand) g.brands.add(it.brand);
      if (it?.is_active && typeof it.unit_price_incl_gst === "number") {
        g.offers.push({ supplier: it.supplier_name || "", brand: it.brand || "", rate: it.unit_price_incl_gst });
        g.lowest = g.lowest === null ? it.unit_price_incl_gst : Math.min(g.lowest, it.unit_price_incl_gst);
      }
    }
    // popup lookup: also include Received Purchase items (latest paid rate per sku, vendor as supplier).
    // Tagged skus join their tag group; untagged ones show up under their own item name.
    if (new URL(req.url).searchParams.get("include") === "received") {
      const recLinks = await db.collection("received_purchase_tags").find({}).toArray();
      const tagsBySku = new Map<string, any[]>();
      for (const l of recLinks as any[]) tagsBySku.set(l.sku, [...(tagsBySku.get(l.sku) || []), l]);
      const client = await clientPromise;
      const latest = await client
        .db()
        .collection("Received purchase")
        .aggregate([
          { $match: { rate: { $gt: 0 } } },
          { $sort: { receivedAt: -1 } },
          { $group: { _id: "$sku", rate: { $first: "$rate" }, vendor: { $first: "$vendor" }, itemName: { $first: "$itemName" } } },
        ])
        .toArray();
      for (const r of latest as any[]) {
        const offer = { supplier: r.vendor || "", brand: "", rate: r.rate, source: "received" };
        const links = tagsBySku.get(r._id) || [];
        const targets = links.length
          ? links.map((l: any) => ({ key: l.tag_key, name: l.tag_name }))
          : r.itemName
            ? [{ key: "rec:" + r._id, name: r.itemName }]
            : [];
        for (const t of targets) {
          let g = groups.get(t.key);
          if (!g) {
            g = { tag_key: t.key, tag_name: t.name, count: 0, brands: new Set(), lowest: null, offers: [] };
            groups.set(t.key, g);
          }
          g.offers.push(offer);
        }
      }
    }
    const list = Array.from(groups.values())
      .map((g) => ({ ...g, brands: Array.from(g.brands).sort(), offers: g.offers.sort((a, b) => a.rate - b.rate) }))
      .sort((a, b) => a.tag_name.localeCompare(b.tag_name));
    return NextResponse.json({ tags: list });
  } catch (error: any) {
    console.error("Pricelist tag summary error:", error);
    return NextResponse.json({ error: error.message || "Failed to load tags" }, { status: 500 });
  }
}
