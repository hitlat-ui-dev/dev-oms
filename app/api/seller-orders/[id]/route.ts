import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import SellerOrder from "@/models/SellerOrder";
import mongoose from "mongoose";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const client = await clientPromise;
    const db = client.db("dev_oms_db");

    // Ensure Mongoose is connected for the Model queries
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGODB_URI as string);
    }

    const updateData = await req.json();

    // 1. Find Original
    const originalOrder = await SellerOrder.findById(id);
    if (!originalOrder) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    // --- LOGIC A: PARTIAL RETURN (SPLIT ORDER) ---
    if (updateData.status === "RETURN ORDER" && updateData.isPartial) {
      const returnQty = Number(updateData.reQty);
      const remainingQty = originalOrder.reQty - returnQty;

      // Create a clean object for the new return record
      const returnOrderObj = originalOrder.toObject();
      delete returnOrderObj._id; // Remove original ID so Mongo creates a new one
      if (returnOrderObj.createdAt) delete returnOrderObj.createdAt;
      if (returnOrderObj.updatedAt) delete returnOrderObj.updatedAt;

      const returnOrderData = {
        ...returnOrderObj,
        reQty: returnQty,
        totalAmount: returnQty * originalOrder.rate,
        status: "RETURN ORDER",
        orderNo: `${originalOrder.orderNo}-R`, // Unique suffix
        isPaid: false
      };

      await SellerOrder.create(returnOrderData);

      // Update original order to represent only what the customer kept
      const updatedOriginal = await SellerOrder.findByIdAndUpdate(
        id,
        {
          reQty: remainingQty,
          totalAmount: remainingQty * originalOrder.rate,
          // Status stays "DELIVERY"
        },
        { new: true }
      );

      // Add partial quantity back to stock
      const itemName = originalOrder.itemName?.trim();
      if (itemName) {
        const stockFilter = { itemName: { $regex: new RegExp(`^${itemName}$`, "i") } };
        await db.collection("stock").updateOne(stockFilter, { $inc: { quantity: returnQty } });
      }

      return NextResponse.json(updatedOriginal, { status: 200 });
    }

    // --- LOGIC B: STANDARD UPDATE (FULL RETURN / STATUS CHANGE) ---
    const updated = await SellerOrder.findByIdAndUpdate(id, { ...updateData }, { new: true });

    const adjustQty = Number(updateData.reQty || updated.reQty || 0);
    const itemName = updated.itemName?.trim();

    if (itemName && adjustQty > 0) {
      const stockFilter = { itemName: { $regex: new RegExp(`^${itemName}$`, "i") } };

      if (updateData.activeTab === "TO CHECK") {
        if (updateData.status === "READY TO SHIP") {
          await db.collection("stock").updateOne(stockFilter, { 
            $inc: { reQty: -adjustQty, quantity: -adjustQty } 
          });
        } else if (updateData.status === "HISAB" || updateData.status === "CANCELL ORDER") {
          await db.collection("stock").updateOne(stockFilter, { 
            $inc: { reQty: -adjustQty } 
          });
        }
      } 
      else if (updateData.activeTab === "READY TO SHIP") {
        // Only trigger for full returns or cancellations in this block
        if (["HISAB", "CANCELL ORDER", "RETURN ORDER"].includes(updateData.status)) {
          await db.collection("stock").updateOne(stockFilter, { 
            $inc: { quantity: adjustQty } 
          });
          console.log(`✅ ${updateData.status}: Restored ${adjustQty} to stock.`);
        }
      }
    }

    return NextResponse.json(updated, { status: 200 });
  } catch (error: any) {
    console.error("PATCH Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}