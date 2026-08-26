import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

// POST /api/items/bulk-confirm-hsn - called from the HSN & GST Review page
// when the user selects several rows (whose HSN/SAC + GST% they've already
// checked are correct) and clicks "Mark Selected Confirmed". Only flips
// hsnGstConfirmed - it never touches the hsnSac/gstPercent values
// themselves (editing those goes through the existing per-item
// PATCH /api/items/[id], which already keeps stock + items in sync).
export async function POST(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");
    const { stockIds } = await req.json();

    if (!Array.isArray(stockIds) || stockIds.length === 0) {
      return NextResponse.json({ error: "stockIds must be a non-empty array." }, { status: 400 });
    }

    const objectIds = stockIds.map((id: string) => new ObjectId(id));

    const stockDocs = await db
      .collection("stock")
      .find({ _id: { $in: objectIds } })
      .project({ itemId: 1 })
      .toArray();

    await db.collection("stock").updateMany(
      { _id: { $in: objectIds } },
      { $set: { hsnGstConfirmed: true } }
    );

    const itemIds = stockDocs.map((s: any) => s.itemId).filter(Boolean).map((id: any) => new ObjectId(id.toString()));
    if (itemIds.length > 0) {
      await db.collection("items").updateMany(
        { _id: { $in: itemIds } },
        { $set: { hsnGstConfirmed: true } }
      );
    }

    return NextResponse.json({ success: true, confirmedCount: stockDocs.length });
  } catch (error: any) {
    console.error("POST bulk-confirm-hsn error:", error);
    return NextResponse.json({ error: error.message || "Failed to confirm HSN/GST" }, { status: 500 });
  }
}
