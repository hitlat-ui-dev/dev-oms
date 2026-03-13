import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

export async function POST(req: NextRequest) {
  try {
    const client = await clientPromise;
    const db = client.db();
    const body = await req.json();

    const { originalOrderId, itemName, receivedQty, orderQty, unit, vendor, rate, remark, prQty } = body;

    // 1. SAVE TO STOCK
    await db.collection("Received purchase").insertOne({
      originalOrderId: new ObjectId(originalOrderId),
      itemName,
      prQty: Number(prQty),
      receivedQty: Number(receivedQty),
      orderQty: Number(orderQty),
      unit,
      vendor,
      rate: Number(rate),
      remark,
      status: "Received Purchase",
      receivedAt: new Date(),
    });

    // 2. CREATE NEW PR FOR BALANCE (Saved to purchase_requests)
    if (Number(receivedQty) < Number(orderQty)) {
      await db.collection("purchase_requests").insertOne({
        itemName,
        prQty: Number(orderQty) - Number(receivedQty), 
        unit,
        status: "Purchase Request",
        createdAt: new Date(),
        remark: `Remaining from Order ${originalOrderId}`,
      });
    }

    // 3. REMOVE FROM ORDER PLACE (Update status in purchase_requests)
    await db.collection("orders").updateOne(
      { _id: new ObjectId(originalOrderId) },
      { $set: { status: "Received" } }
      );
      

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}


export async function PATCH(req: NextRequest) {
  try {
    const client = await clientPromise;
    const db = client.db();
    const { id, receivedQty, rate } = await req.json();

    if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });

    const updateResult = await db.collection("Received purchase").updateOne(
      { _id: new ObjectId(id) },
      { 
        $set: { 
          receivedQty: Number(receivedQty), 
          rate: Number(rate) 
        } 
      }
    );

    return NextResponse.json({ success: true, modifiedCount: updateResult.modifiedCount });
  } catch (error: any) {
    console.error("Update Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}