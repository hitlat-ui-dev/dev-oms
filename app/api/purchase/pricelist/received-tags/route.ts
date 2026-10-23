import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getPricelistDb } from "@/lib/pricelist/db";
import { normalizeName } from "@/lib/pricelist/normalize";

export const runtime = "nodejs";

// Tags on Received Purchase items (a bid item name -> the item's OMS sku). They only live in the
// separate received_purchase_tags collection; the original Received Purchase data is never written.

// POST { tag_name, skus: [], userName }
export async function POST(req: Request) {
  try {
    const { tag_name, skus, userName } = await req.json();
    const name = String(tag_name || "").trim();
    const tag_key = normalizeName(name);
    if (!tag_key) return NextResponse.json({ error: "tag_name is required" }, { status: 400 });
    const list: string[] = Array.from(new Set((Array.isArray(skus) ? skus : []).map((s: any) => String(s || "").trim()).filter(Boolean)));
    if (list.length === 0) return NextResponse.json({ error: "These entries have no SKU to tag" }, { status: 400 });

    const { db } = await getPricelistDb();
    const existing: any = await db.collection("received_purchase_tags").findOne({ tag_key });
    const now = new Date();
    const res = await db.collection("received_purchase_tags").bulkWrite(
      list.map((sku) => ({
        updateOne: {
          filter: { tag_key, sku },
          update: { $setOnInsert: { tag_name: existing?.tag_name || name, tag_key, sku, created_by: userName || "", created_at: now } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
    return NextResponse.json({ ok: true, added: res.upsertedCount, tag_key });
  } catch (error: any) {
    console.error("Received tag add error:", error);
    return NextResponse.json({ error: error.message || "Failed to add tag" }, { status: 500 });
  }
}

// DELETE ?id=<tag doc id>
export async function DELETE(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: "Valid id is required" }, { status: 400 });
    const { db } = await getPricelistDb();
    await db.collection("received_purchase_tags").deleteOne({ _id: new ObjectId(id) });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("Received tag delete error:", error);
    return NextResponse.json({ error: error.message || "Failed to delete tag" }, { status: 500 });
  }
}
