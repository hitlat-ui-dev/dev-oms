import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getPricelistDb } from "@/lib/pricelist/db";
import { normalizeName } from "@/lib/pricelist/normalize";

export const runtime = "nodejs";

// POST { tag_name, sku_keys: [], userName }: single or bulk tag. Duplicate (tag_key, sku_key) pairs are ignored.
export async function POST(req: Request) {
  try {
    const { tag_name, sku_keys, userName } = await req.json();
    const name = String(tag_name || "").trim();
    const tag_key = normalizeName(name);
    if (!tag_key) return NextResponse.json({ error: "tag_name is required" }, { status: 400 });
    if (!Array.isArray(sku_keys) || sku_keys.length === 0) {
      return NextResponse.json({ error: "sku_keys are required" }, { status: 400 });
    }
    const { db } = await getPricelistDb();
    const valid = await db.collection("pricelist_items").distinct("sku_key", { sku_key: { $in: sku_keys } });
    if (valid.length === 0) return NextResponse.json({ error: "No matching pricelist items" }, { status: 404 });

    // Reuse the spelling of an existing tag with the same key so chips stay consistent.
    const existing: any = await db.collection("pricelist_tags").findOne({ tag_key });
    const now = new Date();
    const res = await db.collection("pricelist_tags").bulkWrite(
      valid.map((sku_key: string) => ({
        updateOne: {
          filter: { tag_key, sku_key },
          update: { $setOnInsert: { tag_name: existing?.tag_name || name, tag_key, sku_key, created_by: userName || "", created_at: now } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
    return NextResponse.json({ ok: true, added: res.upsertedCount, tag_key });
  } catch (error: any) {
    console.error("Pricelist tag add error:", error);
    return NextResponse.json({ error: error.message || "Failed to add tag" }, { status: 500 });
  }
}

// DELETE ?id=<tag doc id> removes one item<->tag link; ?tag_key=<key> removes the whole tag.
export async function DELETE(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const { db } = await getPricelistDb();
    const id = sp.get("id");
    const tagKey = sp.get("tag_key");
    if (id) {
      if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
      await db.collection("pricelist_tags").deleteOne({ _id: new ObjectId(id) });
    } else if (tagKey) {
      await db.collection("pricelist_tags").deleteMany({ tag_key: tagKey });
    } else {
      return NextResponse.json({ error: "id or tag_key is required" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("Pricelist tag delete error:", error);
    return NextResponse.json({ error: error.message || "Failed to delete tag" }, { status: 500 });
  }
}
