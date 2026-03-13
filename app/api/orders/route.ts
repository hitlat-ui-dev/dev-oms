import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

export async function POST(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db();
    const body = await req.json();

    const { 
      originalId, 
      itemName, 
      prQty, 
      orderQty, 
      unit, 
      remark, 
      rate, 
      vendor 
    } = body;

    if (!vendor) return NextResponse.json({ error: "Vendor is required" }, { status: 400 });

    // 1. Save the Order into the new 'orders' collection
    const newOrder = {
      purchaseRequestId: originalId,
        itemName,
      prQty: Number(prQty),
      orderQty: Number(orderQty),
      unit,
      remark,
      rate: rate ? Number(rate) : 0, // Rate is not mandatory
      vendor,
      status: "Order Place",
      orderedAt: new Date()
    };
    await db.collection("orders").insertOne(newOrder);

    // 2. Logic for the remaining Quantity in Purchase Request
    const remainingQty = Number(prQty) - Number(orderQty);

    if (remainingQty > 0) {
      // Keep in PR but update the quantity to the remainder
      await db.collection("purchase_requests").updateOne(
        { _id: new ObjectId(originalId) },
        { 
          $set: { 
            prQty: remainingQty,
            updatedAt: new Date() 
          } 
        }
      );
    } else {
      // If fully ordered, remove from PR or change status to "Completed"
      await db.collection("purchase_requests").deleteOne({ _id: new ObjectId(originalId) });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}