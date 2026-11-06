import { NextResponse } from "next/server";
import { getPricelistDb } from "@/lib/pricelist/db";
import { getSignedDownloadUrl } from "@/lib/cloudflareR2";

export const runtime = "nodejs";

// GET: upload history. GET ?download=<id>: redirect to a signed URL of the original file.
// PATCH { id, status: "ACTIVE" | "ARCHIVED" }: manual archive / restore of one upload (label only; items are untouched).
export async function PATCH(req: Request) {
  try {
    const { id, status } = await req.json();
    const { ObjectId } = await import("mongodb");
    if (!ObjectId.isValid(id) || !(status === "ACTIVE" || status === "ARCHIVED")) {
      return NextResponse.json({ error: "Invalid id or status" }, { status: 400 });
    }
    const { db } = await getPricelistDb();
    await db.collection("pricelists").updateOne({ _id: new ObjectId(id) }, { $set: { status } });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Update failed" }, { status: 500 });
  }
}

// DELETE ?id=<pricelist id>: remove one upload together with the items it currently owns
// (pricelist_items.pricelist_id = id) and their tag links. ?count=1 only reports what would go.
// Items last refreshed by a newer upload belong to that upload and are left alone; the original xlsx stays in R2.
export async function DELETE(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const id = sp.get("id") || "";
    const { ObjectId } = await import("mongodb");
    if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const { db } = await getPricelistDb();
    const _id = new ObjectId(id);
    const items = db.collection("pricelist_items");
    const skus = await items.distinct("sku_key", { pricelist_id: _id });
    if (sp.get("count") === "1") return NextResponse.json({ items: skus.length });
    await db.collection("pricelist_tags").deleteMany({ sku_key: { $in: skus } });
    await items.deleteMany({ pricelist_id: _id });
    await db.collection("pricelists").deleteOne({ _id });
    return NextResponse.json({ ok: true, deletedItems: skus.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Delete failed" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { db } = await getPricelistDb();
    const { searchParams } = new URL(req.url);
    const download = searchParams.get("download");
    if (download) {
      const { ObjectId } = await import("mongodb");
      if (!ObjectId.isValid(download)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
      const pl: any = await db.collection("pricelists").findOne({ _id: new ObjectId(download) });
      if (!pl?.file_url) return NextResponse.json({ error: "File not found" }, { status: 404 });
      const url = await getSignedDownloadUrl(pl.file_url, 600, pl.file_name);
      return NextResponse.json({ url });
    }
    const list = await db.collection("pricelists").find({}).sort({ uploaded_at: -1 }).limit(200).toArray();
    return NextResponse.json({ pricelists: list });
  } catch (error: any) {
    console.error("Pricelist history error:", error);
    return NextResponse.json({ error: error.message || "Failed to load history" }, { status: 500 });
  }
}
