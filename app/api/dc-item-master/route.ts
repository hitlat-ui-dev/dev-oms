import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// The reusable item list behind the Delivery Challan screen's typeahead.
// Shared across firms (like Units), and separate from the stock Item master -
// see models/DcItemMaster.ts for why.

const COLLECTION = "dc_item_masters";

/** The uniqueness key: lowercased + whitespace-collapsed, so "Carton  Box"
 * and "carton box" can't both land in the dropdown. */
function nameKeyFor(itemName: string): string {
  return itemName.trim().toLowerCase().replace(/\s+/g, " ");
}

// GET /api/dc-item-master - every master item, most-used first so the
// everyday items stay at the top of the dropdown before any typing.
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db();
    const items = await db
      .collection(COLLECTION)
      .find({})
      .sort({ usageCount: -1, itemName: 1 })
      .toArray();
    return NextResponse.json(items);
  } catch (error: any) {
    console.error("GET dc-item-master error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch DC items" }, { status: 500 });
  }
}

// POST /api/dc-item-master - "Add New Item". Upserts by nameKey rather than
// rejecting a duplicate: the caller's intent is "make sure this item exists
// and give it to me", and an existing entry is a perfectly good answer to
// that. Its unit is refreshed only when the caller actually supplied one, so
// a blank unit never wipes a good one already on file.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const itemName = (body.itemName || "").toString().trim();
    const unit = (body.unit || "").toString().trim();
    const createdBy = (body.createdBy || "").toString().trim();

    if (!itemName) {
      return NextResponse.json({ error: "itemName is required." }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();
    const nameKey = nameKeyFor(itemName);

    const result = await db.collection(COLLECTION).findOneAndUpdate(
      { nameKey },
      {
        $set: { updatedAt: new Date(), ...(unit ? { unit } : {}) },
        $setOnInsert: {
          itemName,
          nameKey,
          ...(unit ? {} : { unit: "" }),
          usageCount: 0,
          createdBy,
          createdAt: new Date(),
        },
      },
      { upsert: true, returnDocument: "after" }
    );

    const item = (result as any)?.value || result;
    return NextResponse.json({ success: true, item }, { status: 201 });
  } catch (error: any) {
    console.error("POST dc-item-master error:", error);
    return NextResponse.json({ error: error.message || "Failed to save DC item" }, { status: 500 });
  }
}
