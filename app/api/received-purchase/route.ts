import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

export async function POST(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");
    const body = await req.json();

    const { 
      originalOrderId, 
      itemName, 
      receivedQty, 
      damageQty, 
      orderQty, 
      sku, 
      moveRemainingTo, 
      vendor,
      unit,
      rate,
      category,
      orderNumber 
    } = body;

    const remainingQty = Number(orderQty) - Number(receivedQty) - Number(damageQty);

    // 1. SAVE TO STOCK (Only increment by received quantity)
    await db.collection("stock").updateOne(
      { sku: sku },
      { 
        $inc: { quantity: Number(receivedQty) }, 
        $set: { itemName, vendor, unit, rate, category, lastUpdated: new Date() } 
      },
      { upsert: true }
    );

    // 2. SAVE TO RECEIVED PURCHASE (Log History)
    await db.collection("Received purchase").insertOne({
      orderNumber,
      itemName,
      sku,
      receivedQty: Number(receivedQty),
      damageQty: Number(damageQty),
      unit,
      vendor,
      rate,
      receivedAt: new Date()
    });

    // --- NEW SECTION: SAVE TO PURCHASE RETURN ---
    if (Number(damageQty) > 0) {
      await db.collection("Purchase Return").insertOne({
        originalOrderNumber: orderNumber,
        itemName,
        sku,
        vendor,
        returnQty: Number(damageQty),
        unit,
        rate: Number(rate),
        totalReturnAmount: Number(damageQty) * Number(rate),
        reason: "Damaged during delivery",
        status: "Pending", // You can use this for tracking credit notes
        createdAt: new Date()
      });
    }
    // --------------------------------------------

    // 3. HANDLE REMAINING QTY
    if (remainingQty > 0) {
      const targetCollection = moveRemainingTo === "Purchase Request" 
        ? "purchase_requests" 
        : "Order place Purchase";

      const remainingData: any = {
        itemName,
        sku,
        category,
        prQty: remainingQty,
        orderQty: remainingQty,
        unit,
        vendor,
        rate,
        status: moveRemainingTo === "Purchase Request" ? "pending" : "Order Place",
        createdAt: new Date()
      };

      if (moveRemainingTo === "Order Place") {
        remainingData.orderNumber = orderNumber;
      }

      await db.collection(targetCollection).insertOne(remainingData);
    }

    // 4. DELETE THE ORIGINAL ORDER
    await db.collection("Order place Purchase").deleteOne({ _id: new ObjectId(originalOrderId) });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Receive Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db"); // Ensure DB name is explicit
    const { id, receivedQty, rate } = await req.json();

    if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });

    // Updated collection name to match POST route
    const updateResult = await db.collection("purchase_received").updateOne(
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