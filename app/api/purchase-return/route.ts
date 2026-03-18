import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

// GET: Fetch Stock and Return Records
export async function GET(req: NextRequest) {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");
    
    // Get all returns for the table
    const returns = await db.collection("Purchase Return").find({}).sort({ createdAt: -1 }).toArray();
    // Get stock for the dropdown
    const stock = await db.collection("stock").find({ quantity: { $gt: 0 } }).toArray();

    return NextResponse.json({ returns, stock });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST: Process the Return
export async function POST(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");
    const { itemId, returnQty, vendor, itemName, sku, reason } = await req.json();

    // 1. Reduce Stock from the 'stock' collection
    const stockUpdate = await db.collection("stock").updateOne(
      { _id: new ObjectId(itemId) },
      { $inc: { quantity: -Number(returnQty) } }
    );

    if (stockUpdate.modifiedCount === 0) {
      return NextResponse.json({ error: "Stock update failed" }, { status: 400 });
    }

    // 2. Save record to 'Purchase Return' DB
    const newReturn = {
      itemName,
      sku,
      vendor,
      returnQty: Number(returnQty),
      reason: reason || "Standard Return",
      createdAt: new Date(),
      status: "Returned"
    };

    await db.collection("Purchase Return").insertOne(newReturn);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}