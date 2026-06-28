import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

// --- PATCH: Handles Updates (Revert to Purchase Request) ---
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = await clientPromise;
    const db = client.db("dev_oms_db");

    // 1. Get the data from "Order place Purchase" first
    const sourceCollection = db.collection("Order place Purchase");
    const itemToMove = await sourceCollection.findOne({ _id: new ObjectId(id) });

    if (!itemToMove) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // 2. Prepare the data for the "purchase_requests" collection
    // Check if an active Purchase Request already exists for this SKU
    const targetCollection = db.collection("purchase_requests");
    const existingPR = await targetCollection.findOne({
      sku: itemToMove.sku || "N/A",
      status: "Purchase Request"
    });

    const qtyToRevert = Number(itemToMove.orderQty || itemToMove.prQty || 0);

    if (existingPR) {
      // Merge by incrementing prQty of the existing PR
      await targetCollection.updateOne(
        { _id: existingPR._id },
        {
          $inc: { prQty: qtyToRevert },
          $set: { updatedAt: new Date() }
        }
      );
      console.log(`[REVERT PR MERGE] SKU: ${itemToMove.sku} | Merged ${qtyToRevert} into existing PR`);
    } else {
      // Create a new PR document
      const { _id, orderNumber, ...restOfData } = itemToMove;
      await targetCollection.insertOne({
        ...restOfData,
        prQty: qtyToRevert,
        status: "Purchase Request",
        updatedAt: new Date()
      });
      console.log(`[REVERT PR CREATE] SKU: ${itemToMove.sku} | Created new PR with qty ${qtyToRevert}`);
    }

    // 3. Delete from the "Order place Purchase" collection
    await sourceCollection.deleteOne({ _id: new ObjectId(id) });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
// --- DELETE: Removes a Request ---
export async function DELETE(
  req: Request, 
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();
    const result = await db.collection("purchase_requests").deleteOne({ 
      _id: new ObjectId(id) 
    });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: "Deleted successfully" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}