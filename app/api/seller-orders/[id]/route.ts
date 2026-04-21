import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import SellerOrder from "@/models/SellerOrder";
import mongoose from "mongoose";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const client = await clientPromise;
    const db = client.db("dev_oms_db");

    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGODB_URI as string);
    }

    const updateData = await req.json();

    // 1. Find Original Order
    const originalOrder = await SellerOrder.findById(id);
    if (!originalOrder) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    // ================================================================
    // LOGIC A: PARTIAL RETURN (SPLIT ORDER)
    // ================================================================
    if (updateData.status === "RETURN ORDER" && updateData.isPartial) {
      const returnQty = Number(updateData.reQty);
      const remainingQty = originalOrder.reQty - returnQty;

      const returnOrderObj = originalOrder.toObject();
      delete returnOrderObj._id;
      if (returnOrderObj.createdAt) delete returnOrderObj.createdAt;
      if (returnOrderObj.updatedAt) delete returnOrderObj.updatedAt;

      const returnOrderData = {
        ...returnOrderObj,
        reQty: returnQty,
        totalAmount: returnQty * originalOrder.rate,
        status: "RETURN ORDER",
        orderNo: `${originalOrder.orderNo}-R`,
        isPaid: false
      };

      await SellerOrder.create(returnOrderData);

      const updatedOriginal = await SellerOrder.findByIdAndUpdate(
        id,
        {
          reQty: remainingQty,
          totalAmount: remainingQty * originalOrder.rate,
        },
        { new: true }
      );

      const itemName = originalOrder.itemName?.trim();
      if (itemName) {
        const stockFilter = { itemName: { $regex: new RegExp(`^${itemName}$`, "i") } };
        await db.collection("stock").updateOne(stockFilter, { $inc: { quantity: returnQty } });
      }

      return NextResponse.json(updatedOriginal, { status: 200 });
    }

    // ================================================================
    // LOGIC C: PARTIAL READY TO SHIP (SPLIT ORDER)
    // ================================================================
    if (updateData.status === "READY TO SHIP" && updateData.isPartialFulfillment) {
      const shipQty = Number(updateData.shipQty);
      const remainingQty = originalOrder.reQty - shipQty;

      // 1. Create the Shipped Child Order
      const shippedOrderObj = originalOrder.toObject();
      delete shippedOrderObj._id;
      if (shippedOrderObj.createdAt) delete shippedOrderObj.createdAt;
      if (shippedOrderObj.updatedAt) delete shippedOrderObj.updatedAt;

      const shippedOrderData = {
        ...shippedOrderObj,
        reQty: shipQty,
        totalAmount: shipQty * originalOrder.rate,
        status: "READY TO SHIP",
        orderNo: `${originalOrder.orderNo}-P1`,
      };
      await SellerOrder.create(shippedOrderData);

      // 2. Update Original Order (Keep in TO CHECK with leftover qty)
      const updatedOriginal = await SellerOrder.findByIdAndUpdate(
        id,
        {
          reQty: remainingQty,
          totalAmount: remainingQty * originalOrder.rate,
        },
        { new: true }
      );

      // 3. Deduct ONLY the shipped amount from stock
      const itemName = originalOrder.itemName?.trim();
      if (itemName) {
        const stockFilter = { itemName: { $regex: new RegExp(`^${itemName}$`, "i") } };
        await db.collection("stock").updateOne(stockFilter, { 
          $inc: { quantity: -shipQty } 
        });
      }

      return NextResponse.json(updatedOriginal, { status: 200 });
    }

    // ================================================================
    // LOGIC B: STANDARD UPDATE (FULL STATUS CHANGE)
    // ================================================================
    
    // 1. STOCK CHECK: Only for full transitions to Ready to Ship
    if (updateData.activeTab === "TO CHECK" && updateData.status === "READY TO SHIP") {
      const itemName = originalOrder.itemName?.trim();
      const orderQty = Number(updateData.reQty || originalOrder.reQty || 0);

      if (itemName) {
        const stockFilter = { itemName: { $regex: new RegExp(`^${itemName}$`, "i") } };
        const stockItem = await db.collection("stock").findOne(stockFilter);

        if (!stockItem || (stockItem.quantity || 0) < orderQty) {
          const available = stockItem?.quantity || 0;
          return NextResponse.json(
            { error: `Insufficient Stock! Available: ${available}, Required: ${orderQty}.` }, 
            { status: 400 }
          );
        }
      }
    }

    // 2. Perform standard update
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
        if (["HISAB", "CANCELL ORDER", "RETURN ORDER"].includes(updateData.status)) {
          await db.collection("stock").updateOne(stockFilter, { 
            $inc: { quantity: adjustQty } 
          });
        }
      }
    }

    return NextResponse.json(updated, { status: 200 });

  } catch (error: any) {
    console.error("PATCH Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}