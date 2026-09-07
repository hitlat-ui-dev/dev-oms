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
    // sku is deliberately NOT editable here. It is an identity, not an
    // attribute: this route writes to `stock` by _id and only mirrors into
    // `items` when the stock doc carries an itemId, so letting an edit change
    // the sku silently drove the two collections apart - several stock rows
    // ended up stamped with whatever next-SKU the form was holding while
    // `items` kept their real ones (S2661/S2635, fixed Sep-2026). If a SKU
    // ever genuinely has to change, it has to change in both collections at
    // once, which is not what this endpoint does.
    if (data.category !== undefined) updateFields.category = data.category;
    if (data.unit !== undefined) updateFields.unit = data.unit;
    if (data.location !== undefined) updateFields.location = data.location;
    if (data.hidden !== undefined) updateFields.hidden = data.hidden;
    if (data.rate !== undefined) updateFields.rate = data.rate !== "" ? Number(data.rate) : null;
    if (data.hsnSac !== undefined) updateFields.hsnSac = data.hsnSac;
    if (data.gstPercent !== undefined) updateFields.gstPercent = data.gstPercent !== "" ? Number(data.gstPercent) : 0;
    if (data.hsnGstConfirmed !== undefined) updateFields.hsnGstConfirmed = !!data.hsnGstConfirmed;
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

    // No itemId means this stock row has no link back to `items`, so the sync
    // below cannot run. Silently skipping it is what let the two collections
    // drift for months - say so instead, and let the caller see it.
    if (!targetItemId) {
      console.warn(`Stock doc ${id} has no itemId - items collection NOT synced.`);
    }

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
      itemsUpdated: itemsResult.matchedCount > 0,
      // Surfaced so a half-applied edit is visible rather than looking clean.
      itemsLinkMissing: !targetItemId,
    });

  } catch (error: any) {
    console.error("CRITICAL SYNC ERROR:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}