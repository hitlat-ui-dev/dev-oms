import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function POST(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db"); // Ensure this matches your DB name
    const body = await req.json();

    // Note: GeM orders no longer go through this route - they're ingested via
    // POST /api/gem-orders (staging in raw_gem_orders) and only reach
    // sellerorders after review via POST /api/gem-orders/[id].

    const {
      originalId, itemName, prQty, orderQty, 
      unit, remark, rate, vendor, sku, category, location 
    } = body;

    if (!vendor) return NextResponse.json({ error: "Vendor is required" }, { status: 400, headers: corsHeaders });

    // 1. ATOMIC COUNTER LOGIC
    // This increments the number first, then returns it. 
    // Even if you delete order 0018, the counter stays at 18.
    const counterResult = await db.collection("counters").findOneAndUpdate(
      { _id: "orderId" as any },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after" }
    );

    const updatedDoc = counterResult?.value || counterResult;
const nextNumber = updatedDoc?.seq || 1;

const orderID = nextNumber.toString().padStart(4, '0');

    // 2. Construct the record
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

    // 3. Save to "Order place Purchase"
    await db.collection("Order place Purchase").insertOne(newOrder);

    // 4. Handle Purchase Request Update/Delete
    const remainingQty = Number(prQty) - Number(orderQty);
    if (remainingQty > 0) {
      await db.collection("purchase_requests").updateOne(
        { _id: new ObjectId(originalId) },
        { $set: { prQty: remainingQty, updatedAt: new Date() } }
      );
    } else {
      await db.collection("purchase_requests").deleteOne({ _id: new ObjectId(originalId) });
    }

    return NextResponse.json({ success: true, orderNumber: orderID }, { headers: corsHeaders });

  } catch (error: any) {
    console.error("Save Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}