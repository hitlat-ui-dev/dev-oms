import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

export async function PATCH(
  req: Request, 
  { params }: { params: Promise<{ id: string }> } 
) {
  try {
    // 1. Next.js 15 requires awaiting params
    const { id } = await params;

    // 2. Validate the ID format
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
    }

    const { receivedQty } = await req.json();
    const incomingQty = Number(receivedQty);

    const client = await clientPromise;
    const db = client.db(); 
    const collection = db.collection("purchase_requests");

    // 3. Find the original document
    const originalRequest = await collection.findOne({ _id: new ObjectId(id) });

    if (!originalRequest) {
      // If this triggers, check if your DB name and collection name are correct
      return NextResponse.json({ error: "Request not found in database" }, { status: 404 });
    }

    const requestedQty = Number(originalRequest.qty);

    // --- LOGIC: PARTIAL RECEIVING (The Split) ---
    if (incomingQty < requestedQty && incomingQty > 0) {
      // Update original: Keep in "Purchase Request" with remaining qty
      await collection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { qty: requestedQty - incomingQty, updatedAt: new Date() } }
      );

      // Create new: Move to "Received Purchase" with the qty received
      const { _id, ...rest } = originalRequest;
      await collection.insertOne({
        ...rest,
        qty: incomingQty,
        receivedQty: incomingQty,
        status: "Received Purchase",
        createdAt: new Date(),
        parentRequestId: new ObjectId(id)
      });

      return NextResponse.json({ success: true, message: "Partial receipt split" });
    } 

    // --- LOGIC: FULL RECEIVING ---
    else {
      await collection.updateOne(
        { _id: new ObjectId(id) },
        { 
          $set: { 
            status: "Received Purchase", 
            receivedQty: incomingQty,
            qty: incomingQty,
            updatedAt: new Date()
          } 
        }
      );
      return NextResponse.json({ success: true, message: "Full receipt updated" });
    }

  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}