import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");
    
    // 1. Unwrap params (Fixes the Promise error in your console)
    const { id } = await params;
    const data = await req.json();

    // 2. Define the exact fields allowed to change
    const updateFields = {
      itemName: data.itemName,
      sku: data.sku,
      category: data.category,
      unit: data.unit,
      location: data.location
    };

    // 3. STEP A: Update the Stock document first
    const stockResult = await db.collection("stock").findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updateFields },
      { returnDocument: 'after' } // Get the updated doc to find the itemId
    );

    // 4. STEP B: Sync to Items DB using the itemId found in the database
    let itemsResult = { matchedCount: 0 };
    
    // Use the itemId directly from the database record we just found
    const targetItemId = stockResult?.itemId || data.itemId;

    if (targetItemId) {
      itemsResult = await db.collection("items").updateOne(
        { _id: new ObjectId(targetItemId.toString()) }, // Force conversion to ObjectId
        { $set: {
            itemName: updateFields.itemName,
            sku: updateFields.sku,
            category: updateFields.category,
            unit: updateFields.unit,
            location: updateFields.location
        }}
      );
    }

    console.log(`Sync Logic -> Stock Updated: ${!!stockResult}, Items Matched: ${itemsResult.matchedCount}`);

    return NextResponse.json({
      success: true,
      stockUpdated: !!stockResult,
      itemsUpdated: itemsResult.matchedCount > 0
    });

  } catch (error: any) {
    console.error("CRITICAL SYNC ERROR:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}