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

    // 2. Define the fields allowed to change dynamically
    const updateFields: any = {};
    if (data.itemName !== undefined) updateFields.itemName = data.itemName;
    if (data.sku !== undefined) updateFields.sku = data.sku;
    if (data.category !== undefined) updateFields.category = data.category;
    if (data.unit !== undefined) updateFields.unit = data.unit;
    if (data.location !== undefined) updateFields.location = data.location;
    if (data.hidden !== undefined) updateFields.hidden = data.hidden;
    if (data.rate !== undefined) updateFields.rate = data.rate !== "" ? Number(data.rate) : null;
    if (data.hsnSac !== undefined) updateFields.hsnSac = data.hsnSac;
    if (data.gstPercent !== undefined) updateFields.gstPercent = data.gstPercent !== "" ? Number(data.gstPercent) : 0;
    if (data.variantGroup !== undefined) updateFields.variantGroup = data.variantGroup;
    if (data.variantLabel !== undefined) updateFields.variantLabel = data.variantLabel;

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
        { $set: updateFields }
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