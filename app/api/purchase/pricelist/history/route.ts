import { NextResponse } from "next/server";
import { getPricelistDb } from "@/lib/pricelist/db";
import { getSignedDownloadUrl } from "@/lib/cloudflareR2";

export const runtime = "nodejs";

// GET: upload history. GET ?download=<id>: redirect to a signed URL of the original file.
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
