import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { getPricelistDb } from "@/lib/pricelist/db";

export const runtime = "nodejs";

// GET: the same "Received purchase" rows the Purchase > Received Purchase tab shows (same
// aggregation, category joined from items by sku), plus the bid-item tags attached to each
// row's sku (received_purchase_tags). Read-only on the original data.
export async function GET() {
  try {
    const client = await clientPromise;
    const rows = await client
      .db()
      .collection("Received purchase")
      .aggregate([
        { $lookup: { from: "items", localField: "sku", foreignField: "sku", as: "masterDetails" } },
        { $addFields: { category: { $arrayElemAt: ["$masterDetails.category", 0] } } },
        { $project: { masterDetails: 0 } },
      ])
      .toArray();

    const { db } = await getPricelistDb();
    const links = await db.collection("received_purchase_tags").find({}).sort({ created_at: 1 }).toArray();
    const bySku = new Map<string, { _id: string; tag_key: string; tag_name: string }[]>();
    for (const l of links as any[]) {
      const list = bySku.get(l.sku) || [];
      list.push({ _id: String(l._id), tag_key: l.tag_key, tag_name: l.tag_name });
      bySku.set(l.sku, list);
    }

    return NextResponse.json({ rows: rows.map((r: any) => ({ ...r, tags: (r.sku && bySku.get(r.sku)) || [] })) });
  } catch (error: any) {
    console.error("Received-with-tags error:", error);
    return NextResponse.json({ rows: [], error: error.message || "Failed to load" }, { status: 500 });
  }
}
