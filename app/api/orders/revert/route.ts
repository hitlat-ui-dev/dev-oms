import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

export async function POST(req: NextRequest) {
  try {
    const client = await clientPromise;
    const db = client.db();
    const { orderId } = await req.json();

    // 1. Find the order in the 'orders' collection first
    const order = await db.collection("orders").findOne({ _id: new ObjectId(orderId) });

    if (!order) {
      return NextResponse.json({ success: false, error: "Order not found" }, { status: 404 });
    }

    // 2. Re-insert/Update back into 'purchase_requests'
    // We use originalRequestId if you stored it, otherwise create a new entry
    await db.collection("purchase_requests").insertOne({
      itemName: order.itemName,
      prQty: order.prQty,
      unit: order.unit,
      status: "Purchase Request",
      createdAt: new Date(),
      remark: `Reverted from Order: ${orderId}`
    });

    // 3. Delete from 'orders' collection
    await db.collection("orders").deleteOne({ _id: new ObjectId(orderId) });

    return NextResponse.json({ success: true, message: "Reverted successfully" });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}