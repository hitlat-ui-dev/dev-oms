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
    // LOGIC A: RETURN ORDER (WITH MOVE TO TO-CHECK FEATURE)
    // ================================================================
    if (updateData.status === "RETURN ORDER") {
      const returnQty = Number(updateData.reQty);
      const itemName = originalOrder.itemName?.trim();
      const stockFilter = itemName ? { itemName: { $regex: new RegExp(`^${itemName}$`, "i") } } : null;

      // Get the base order number (removes any existing -1, -2, etc.)
      const baseOrderNo = originalOrder.orderNo.split('-')[0];
      const returnRecordCount = await SellerOrder.countDocuments({
        orderNo: { $regex: new RegExp(`^${baseOrderNo}-Re`) }
      });
      const nextReNumber = returnRecordCount + 1;
      const returnOrderNo = `${baseOrderNo}-Re${nextReNumber}`;

      // 1. Create the Return Record Order
      const returnOrderObj = originalOrder.toObject();
      delete returnOrderObj._id;
      if (returnOrderObj.createdAt) delete returnOrderObj.createdAt;
      if (returnOrderObj.updatedAt) delete returnOrderObj.updatedAt;

      const returnOrderData = {
        ...returnOrderObj,
        reQty: returnQty,
        totalAmount: returnQty * originalOrder.rate,
        status: "RETURN ORDER",
        orderNo: returnOrderNo,
        isPaid: false
      };
      await SellerOrder.create(returnOrderData);

      // 2. NEW: Create a duplicate "TO CHECK" order if requested
      if (updateData.moveToCheck) {
        const resubOrderNo = `${baseOrderNo}-RE-N${nextReNumber}`;
        const toCheckOrderData = {
          ...returnOrderObj,
          reQty: returnQty,
          totalAmount: returnQty * originalOrder.rate,
          status: "TO CHECK",
          orderNo: resubOrderNo,
          isPaid: false
        };
        await SellerOrder.create(toCheckOrderData);

        // Increase reQty (Pending Stock) for the new TO CHECK order
        if (stockFilter) {
          await db.collection("stock").updateOne(stockFilter, { $inc: { reQty: returnQty } });
        }
      }

      // 3. Update or Delete the Original Order
      let updatedOriginal = null;
      if (updateData.isPartial) {
        const remainingQty = originalOrder.reQty - returnQty;
        updatedOriginal = await SellerOrder.findByIdAndUpdate(
          id,
          {
            reQty: remainingQty,
            totalAmount: remainingQty * originalOrder.rate,
          },
          { new: true }
        );
      } else {
        // If full return, delete or move original out of Delivery
        updatedOriginal = await SellerOrder.findByIdAndDelete(id);
      }

      // 4. Update Main Stock (Add items back to physical quantity)

      // if (stockFilter) {
      //   await db.collection("stock").updateOne(stockFilter, { $inc: { quantity: returnQty } });
      // }

      return NextResponse.json(updatedOriginal || { success: true }, { status: 200 });
    }

    // ================================================================
    // LOGIC C: PARTIAL READY TO SHIP (SPLIT ORDER)
    // ================================================================
    const shipQty = Number(updateData.shipQty);

    // CHANGE: Only enter this block if shipQty is LESS than total order qty
    if (
      updateData.status === "READY TO SHIP" &&
      updateData.isPartialFulfillment &&
      shipQty < originalOrder.reQty
    ) {

      const remainingQty = originalOrder.reQty - shipQty;

      // 1. GENERATE SEQUENTIAL ORDER NUMBER (P1, P2, etc.)
      const baseOrderNo = originalOrder.orderNo.split('-P')[0];

      const partialCount = await SellerOrder.countDocuments({
        orderNo: { $regex: new RegExp(`^${baseOrderNo}-P`) }
      });

      const nextPNumber = partialCount + 1;
      const newOrderNo = `${baseOrderNo}-P${nextPNumber}`;

      // 2. Create the Shipped Child Order
      const shippedOrderObj = originalOrder.toObject();
      delete shippedOrderObj._id;

      if (shippedOrderObj.createdAt) delete shippedOrderObj.createdAt;
      if (shippedOrderObj.updatedAt) delete shippedOrderObj.updatedAt;

      const shippedOrderData = {
        ...shippedOrderObj,
        reQty: shipQty,
        totalAmount: shipQty * originalOrder.rate,
        status: "READY TO SHIP",
        orderNo: newOrderNo,
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
          $inc: { quantity: -shipQty, reQty: -shipQty }
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

      // FIX: Check shipQty from modal first, then reQty, then original
      const orderQty = Number(updateData.shipQty || updateData.reQty || originalOrder.reQty || 0);

      if (itemName) {
        const stockFilter = { itemName: { $regex: new RegExp(`^${itemName}$`, "i") } };
        const stockItem = await db.collection("stock").findOne(stockFilter);
        const available = stockItem?.quantity || 0;

        // If stock is insufficient, we only block if it's NOT a "Partial Fulfillment" 
        // request that happens to be for the full amount.
        if (available < orderQty) {
          // If you want to allow shipping even with 0 stock when using the modal:
          // You can check if updateData.shipQty exists to bypass this block.
          if (!updateData.shipQty) {
            return NextResponse.json(
              { error: `Insufficient Stock! Available: ${available}, Required: ${orderQty}.` },
              { status: 400 }
            );
          }
        }
      }
    }

    // Inside your Logic B (Standard Updates)
if (updateData.status === "RETURN RECEIVED" && updateData.activeTab === "RETURN ORDER") {
  
  // 1. Clean the Item Name (Removes accidental spaces)
  const itemName = updateData.itemName?.trim();
  const returnQty = Number(updateData.reQty);

  if (itemName) {
    // 2. Use Case-Insensitive Matching
    const stockFilter = { 
      itemName: { $regex: new RegExp(`^${itemName}$`, "i") } 
    };
    
    // 3. Update the Stock
    const stockUpdate = await db.collection("stock").updateOne(stockFilter, { 
      $inc: { quantity: returnQty } 
    });

    // LOGGING: Check your terminal to see if it actually found the item
    console.log(`Stock update result for ${itemName}:`, stockUpdate.modifiedCount);
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
      else if (updateData.activeTab === "CANCELL ORDER") {
        if (updateData.status === "TO CHECK") {
          // Put the quantity back into the "Pending" (reQty) pool
          await db.collection("stock").updateOne(stockFilter, {
            $inc: { reQty: adjustQty }
          });
        }
      }
      else if (updateData.activeTab === "HISAB") {
        if (updateData.status === "TO CHECK") {
          // Put the quantity back into the "Pending" (reQty) pool
          await db.collection("stock").updateOne(stockFilter, {
            $inc: { reQty: adjustQty }
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