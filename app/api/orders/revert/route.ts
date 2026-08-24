import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

export async function POST(req: NextRequest) {
  try {
    const client = await clientPromise;
    const db = client.db();
    const { orderId } = await req.json();

    // 1. Find the order in the 'Order place Purchase' collection first
    // (the row being reverted is created by app/api/orders/route.ts's POST,
    // which saves into "Order place Purchase" - there is no "orders"
    // collection anywhere else in the app, so this lookup always returned
    // null and the revert silently 404'd)
    const order = await db.collection("Order place Purchase").findOne({ _id: new ObjectId(orderId) });

    if (!order) {
      return NextResponse.json({ success: false, error: "Order not found" }, { status: 404 });
    }

    // 2. Re-insert/Update back into 'purchase_requests', carrying over sku/
    // itemId/category so this reverted request still resolves to the same
    // item instead of falling back to a name match that could hit a hidden
    // duplicate (see app/api/purchase/route.ts's POST for the same concern)
    await db.collection("purchase_requests").insertOne({
      itemId: order.itemId,
      itemName: order.itemName,
      sku: order.sku,
      category: order.category,
      prQty: order.prQty,
      unit: order.unit,
      status: "Purchase Request",
      createdAt: new Date(),
      remark: `Reverted from Order: ${orderId}`
    });

    // 3. Delete from 'Order place Purchase' collection
    await db.collection("Order place Purchase").deleteOne({ _id: new ObjectId(orderId) });

    return NextResponse.json({ success: true, message: "Reverted successfully" });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}