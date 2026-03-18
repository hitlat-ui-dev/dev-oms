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
      vendor,
      sku,
      category,
      location 
    } = body;

    if (!vendor) return NextResponse.json({ error: "Vendor is required" }, { status: 400 });

    // 1. Target the NEW collection name: "Order place Purchase"
    const orderCollection = db.collection("Order place Purchase");
    

    // 2. Generate the 3-digit Order Number (001, 002...)
    const lastOrder = await orderCollection
      .find({}, { projection: { orderNumber: 1 } })
      .sort({ orderNumber: -1 }) 
      .limit(1)
      .toArray();

    let nextNumber = 1;
    if (lastOrder.length > 0 && lastOrder[0].orderNumber) {
      // Convert the existing string "0015" to number 15, then add 1
      nextNumber = parseInt(lastOrder[0].orderNumber) + 1;
    }

    // Format to at least 3 digits (e.g., 15 becomes "015", 16 becomes "016")
    const orderID = nextNumber.toString().padStart(3, '0');

    // 3. Construct the record with Master Data (SKU, Category, Location)
    const newOrder = {
      orderNumber: orderID,
      purchaseRequestId: originalId,
      itemName,
      sku: sku || "N/A",
      category: category || "General",
      location: location || "---",
      prQty: Number(prQty),
      orderQty: Number(orderQty),
      unit,
      remark,
      rate: rate ? Number(rate) : 0,
      vendor,
      status: "Order Place",
      createdAt: new Date() 
    };

    // 4. Save to the NEW collection location
    await orderCollection.insertOne(newOrder);

    // 5. Handle the Purchase Request (Update or Delete)
    const remainingQty = Number(prQty) - Number(orderQty);

    if (remainingQty > 0) {
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
      await db.collection("purchase_requests").deleteOne({ _id: new ObjectId(originalId) });
    }

    return NextResponse.json({ 
      success: true, 
      orderNumber: orderID 
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}