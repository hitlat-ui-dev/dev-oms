import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

// Updates a single "Order place Purchase" row - the manual note (Order Place
// tab's per-row note popover, kept separate from `remark`, which is
// auto-filled from the source Purchase Request and must never be touched by
// this manual field) and/or the vendor (per-row vendor edit, for when the
// wrong vendor got picked at order-creation time and the order is still
// sitting in Order Place, not yet received).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
    }

    const body = await req.json();
    const update: Record<string, any> = { updatedAt: new Date() };
    if ("manualRemark" in body) update.manualRemark = body.manualRemark || "";
    if ("vendor" in body) {
      const vendor = (body.vendor || "").toString().trim();
      if (!vendor) {
        return NextResponse.json({ error: "Vendor cannot be empty" }, { status: 400 });
      }
      update.vendor = vendor;
    }

    const client = await clientPromise;
    const db = client.db();
    const result = await db.collection("Order place Purchase").updateOne(
      { _id: new ObjectId(id) },
      { $set: update }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
