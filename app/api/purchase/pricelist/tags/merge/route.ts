import { NextResponse } from "next/server";
import { getPricelistDb } from "@/lib/pricelist/db";
import { moveTag } from "@/lib/pricelist/tagOps";

export const runtime = "nodejs";

// PATCH { from_key, to_key }: fold one tag into another existing tag.
export async function PATCH(req: Request) {
  try {
    const { from_key, to_key } = await req.json();
    if (!from_key || !to_key || from_key === to_key) {
      return NextResponse.json({ error: "Two different tags are required" }, { status: 400 });
    }
    const { db } = await getPricelistDb();
    const target: any = await db.collection("pricelist_tags").findOne({ tag_key: to_key });
    if (!target) return NextResponse.json({ error: "Target tag not found" }, { status: 404 });
    const r = await moveTag(db, from_key, target.tag_name);
    return NextResponse.json({ ok: true, ...r });
  } catch (error: any) {
    console.error("Pricelist tag merge error:", error);
    return NextResponse.json({ error: error.message || "Merge failed" }, { status: 500 });
  }
}
