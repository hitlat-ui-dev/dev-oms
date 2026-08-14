import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { getRemainingOut } from "@/lib/advanceOrders";

const DB_NAME = "dev_oms_db";

// GET: open Advance Orders (same institute + item, remaining balance > 0) eligible to
// auto-merge with a new order being created — powers the inline suggestion banner on the
// Add Order form. Read-only.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const instituteName = searchParams.get("instituteName");
    const itemId = searchParams.get("itemId");
    if (!instituteName || !itemId || !ObjectId.isValid(itemId)) {
      return NextResponse.json({ error: "instituteName and a valid itemId are required" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);

    const candidates = await db
      .collection("sellerorders")
      .find({ isAdvanceOrder: true, instituteName, itemId: new ObjectId(itemId) })
      .sort({ createdAt: 1 }) // oldest advance shipment first
      .toArray();

    const withRemaining = await Promise.all(
      candidates.map(async (o) => ({
        orderId: String(o._id),
        orderNo: o.orderNo,
        remainingQty: await getRemainingOut(db, String(o._id), o.reQty),
      }))
    );

    return NextResponse.json(withRemaining.filter((c) => c.remainingQty > 0));
  } catch (error: any) {
    console.error("advance-order-links candidates GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch candidates" }, { status: 500 });
  }
}
