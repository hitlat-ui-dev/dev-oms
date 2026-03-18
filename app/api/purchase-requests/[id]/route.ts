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
    // We remove the old _id to let MongoDB create a new one, or keep it if you prefer
    const { _id, orderNumber, ...restOfData } = itemToMove;

    const targetCollection = db.collection("purchase_requests");
    await targetCollection.insertOne({
      ...restOfData,
      status: "pending", // Reset status
      updatedAt: new Date()
    });

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