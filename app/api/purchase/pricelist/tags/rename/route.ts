import { NextResponse } from "next/server";
import { getPricelistDb } from "@/lib/pricelist/db";
import { moveTag } from "@/lib/pricelist/tagOps";

export const runtime = "nodejs";

// PATCH { tag_key, new_name }
export async function PATCH(req: Request) {
  try {
    const { tag_key, new_name } = await req.json();
    if (!tag_key || !String(new_name || "").trim()) {
      return NextResponse.json({ error: "tag_key and new_name are required" }, { status: 400 });
    }
    const { db } = await getPricelistDb();
    const r = await moveTag(db, tag_key, String(new_name));
    return NextResponse.json({ ok: true, ...r });
  } catch (error: any) {
    console.error("Pricelist tag rename error:", error);
    return NextResponse.json({ error: error.message || "Rename failed" }, { status: 500 });
  }
}
