import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

// Updates the manual note on a single "Order place Purchase" row (Order
// Place tab's per-row note popover) - kept separate from `remark`, which is
// auto-filled from the source Purchase Request and must never be touched by
// this manual field.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
    }

    const { manualRemark } = await req.json();

    const client = await clientPromise;
    const db = client.db();
    const result = await db.collection("Order place Purchase").updateOne(
      { _id: new ObjectId(id) },
      { $set: { manualRemark: manualRemark || "", updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
