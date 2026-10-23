import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

// gem_bid_item_master - one doc per canonical item, holding exactly the
// fields that have nowhere else to live (every other Central Bid Item
// Rates column is read straight off gem_bid_item_rate_log/
// gem_bid_item_market_rate_history, see ../item-rates/route.ts):
// alternateNames (other ways this same item gets typed on a BOQ - see
// that same route's own comment on how these feed back into
// /api/gem-bids/boq's suggestions), preferredRate, and remarks. Created
// lazily (upsert) the first time any of these three is actually set for
// an item - most items never need one at all.

// POST { itemKey, itemTitle, field: "alternateNames"|"preferredRate"|"remarks", value }
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { itemKey, itemTitle, field, value } = body;
    if (!itemKey || typeof itemKey !== "string") {
      return NextResponse.json({ error: "itemKey is required" }, { status: 400 });
    }
    if (!["alternateNames", "preferredRate", "remarks"].includes(field)) {
      return NextResponse.json({ error: "field must be alternateNames, preferredRate, or remarks" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const now = new Date();

    const set: Record<string, any> = { itemKey, updatedAt: now };
    if (field === "alternateNames") {
      if (!Array.isArray(value)) return NextResponse.json({ error: "alternateNames must be an array" }, { status: 400 });
      set.alternateNames = value.map((v: any) => String(v || "").trim()).filter(Boolean);
    } else {
      set[field] = String(value ?? "").trim();
    }

    await db.collection("gem_bid_item_master").updateOne(
      { itemKey },
      { $set: set, $setOnInsert: { itemTitle: itemTitle || itemKey, createdAt: now } },
      { upsert: true }
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("GeM bid item-master error:", error);
    return NextResponse.json({ error: error.message || "Failed to save" }, { status: 500 });
  }
}
