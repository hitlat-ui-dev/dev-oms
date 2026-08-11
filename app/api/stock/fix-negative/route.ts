import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// POST /api/stock/fix-negative
// Resets all negative `quantity` and `currentStock` values to 0 in stock + items collections.
export async function POST() {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");

    // 1. Fix stock collection — set quantity to 0 wherever it's negative
    const stockResult = await db.collection("stock").updateMany(
      { quantity: { $lt: 0 } },
      [{ $set: { quantity: { $max: [0, "$quantity"] } } }]
    );

    // 2. Fix items collection — set currentStock to 0 wherever it's negative
    const itemsResult = await db.collection("items").updateMany(
      { currentStock: { $lt: 0 } },
      [{ $set: { currentStock: { $max: [0, "$currentStock"] } } }]
    );

    return NextResponse.json({
      success: true,
      stockFixed: stockResult.modifiedCount,
      itemsFixed: itemsResult.modifiedCount,
      message: `Fixed ${stockResult.modifiedCount} stock record(s) and ${itemsResult.modifiedCount} item(s).`
    });

  } catch (error: any) {
    console.error("Fix Negative Stock Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
