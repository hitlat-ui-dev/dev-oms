import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import SellerOrder from "@/models/SellerOrder";
import mongoose from "mongoose";

export async function PATCH(
  req: Request, 
  { params }: { params: Promise<{ id: string }> } 
) {
  try {
    const { id } = await params; 
    const client = await clientPromise;
    const db = client.db("dev_oms_db");

    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGODB_URI as string);
    }

    // 1. Get the update data from request (can be isPaid or status)
    const updateData = await req.json();
    
    // 2. Find the original order first (to check current status)
    const originalOrder = await SellerOrder.findById(id);
    if (!originalOrder) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // 3. Perform the update in SellerOrder
    const updated = await SellerOrder.findByIdAndUpdate(
      id, 
      { ...updateData }, 
      { new: true }
    );

    // 4. ACTION: If status changed to "READY TO SHIP" 
    // AND it wasn't already "READY TO SHIP" (prevents double deduction)
    if (updateData.status === "READY TO SHIP" && originalOrder.status !== "READY TO SHIP") {
      const orderQty = Number(updated.reQty || 0);
      
      let stockQuery: any = null;
      // Prefer ID for matching, fallback to Name
      if (updated.itemId && mongoose.Types.ObjectId.isValid(updated.itemId)) {
        stockQuery = { _id: new mongoose.Types.ObjectId(updated.itemId) };
      } else if (updated.itemName) {
        stockQuery = { itemName: updated.itemName };
      }

      if (stockQuery && orderQty > 0) {
        // --- THE MATH: quantity - orderQty AND reQty - orderQty ---
        await db.collection("stock").updateOne(
          stockQuery,
          { 
            $inc: { 
              quantity: -orderQty, 
              reQty: -orderQty 
            } 
          }
        );
        console.log(`Stock adjusted for ${updated.itemName}: -${orderQty}`);
      }
    }

    return NextResponse.json(updated, { status: 200 });
  } catch (error: any) {
    console.error("PATCH Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}