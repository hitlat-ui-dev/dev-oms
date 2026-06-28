import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import SellerOrder from "@/models/SellerOrder";
import mongoose from "mongoose";

/** Escapes special regex characters in user-controlled strings to prevent RegEx injection */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function syncPurchaseRequest(
  db: any,
  sku: string,
  itemDetails?: { itemId?: string; itemName?: string; category?: string; unit?: string; orderNo?: string }
) {
  if (!sku) return;
  const stockDoc = await db.collection("stock").findOne({ sku: sku });
  if (!stockDoc) return;

  const availableStock = Number(stockDoc.quantity || 0);
  const totalReQty = Number(stockDoc.reQty || 0);

  // Calculate active purchase orders (ordered stock on the way)
  const opOrders = await db.collection("Order place Purchase").find({ sku: sku }).toArray();
  const orderedStock = opOrders.reduce((sum: number, o: any) => sum + Number(o.orderQty || 0), 0);

  const deficit = totalReQty - (availableStock + orderedStock);

  const existingPR = await db.collection("purchase_requests").findOne({
    sku: sku,
    status: "Purchase Request"
  });

  // Get all pending seller orders for this item SKU to aggregate remarks
  const pendingOrders = await db.collection("sellerorders").find({ sku: sku, status: "TO CHECK" }).toArray();
  const aggregatedRemark = pendingOrders
    .filter((o: any) => o.remark && o.remark.trim() !== "" && o.remark.trim() !== "No Remark")
    .map((o: any) => `• ${o.instituteName || "Unknown Buyer"}: ${o.remark.trim()}`)
    .join("\n");

  if (deficit > 0) {
    if (existingPR) {
      await db.collection("purchase_requests").updateOne(
        { _id: existingPR._id },
        {
          $set: {
            prQty: deficit,
            remark: aggregatedRemark || "Auto-generated deficit check",
            updatedAt: new Date()
          }
        }
      );
      console.log(`[SYNC PR UPDATE] SKU: ${sku} | Updated PR | Qty: ${existingPR.prQty} → ${deficit}`);
    } else {
      await db.collection("purchase_requests").insertOne({
        itemId: itemDetails?.itemId || String(stockDoc._id || ""),
        itemName: itemDetails?.itemName || stockDoc.itemName || "",
        sku: sku,
        category: itemDetails?.category || stockDoc.category || "GENERAL",
        unit: itemDetails?.unit || stockDoc.unit || "NOS",
        prQty: deficit,
        remark: aggregatedRemark || (itemDetails?.orderNo ? `Auto-generated from Order ${itemDetails.orderNo}` : "Auto-generated deficit check"),
        status: "Purchase Request",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log(`[SYNC PR CREATE] SKU: ${sku} | Created PR | Qty: ${deficit}`);
    }
  } else {
    if (existingPR) {
      await db.collection("purchase_requests").deleteOne({ _id: existingPR._id });
      console.log(`[SYNC PR DELETE] SKU: ${sku} | Deficit resolved, deleted PR`);
    }
  }
}

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

    // 🛑 1. BACKEND DOUBLE-CLICK GUARD CLAUSE:
    if (updateData.activeTab === "TO CHECK" && originalOrder.status === "READY TO SHIP") {
      console.warn(`🛑 Double-click blocked in backend for order: ${originalOrder.orderNo}`);
      return NextResponse.json(
        { error: "This order has already been processed as Ready to Ship!" },
        { status: 400 }
      );
    }

    // Safely extract the structural keys straight from the MongoDB source
    const itemSku = originalOrder.sku?.trim();
    if (!itemSku) {
      return NextResponse.json({ error: "Order record is missing a SKU code." }, { status: 400 });
    }

    // Define bulletproof stock query filter using the item SKU code
    const stockFilter = { sku: itemSku };

    // ================================================================
    // LOGIC ITEM_CHANGE: PRODUCT NAME / SKU CHANGED DURING EDIT
    // When editing an order and switching to a different product,
    // we must remove the old item's reQty and add to the new item.
    // ================================================================
    const newSku = updateData.sku?.trim();
    const isItemChanged = newSku && itemSku && newSku !== itemSku;

    if (isItemChanged) {
      // Only allow product changes on TO CHECK orders
      if (originalOrder.status !== "TO CHECK") {
        return NextResponse.json(
          { error: "Product can only be changed on TO CHECK orders." },
          { status: 400 }
        );
      }

      const oldReQty = Number(originalOrder.reQty || 0);
      const newReQty = Number(updateData.reQty ?? updateData.orderQty ?? oldReQty);
      const newStockFilter = { sku: newSku };

      // 1. REMOVE old item's reQty contribution (decrement from old SKU)
      await db.collection("stock").updateOne(stockFilter, {
        $inc: { reQty: -oldReQty }
      });
      await db.collection("items").updateOne(
        { sku: itemSku },
        { $inc: { reQty: -oldReQty } }
      );

      console.log(
        `[ITEM CHANGE] Old SKU: ${itemSku} | Removed reQty: ${oldReQty}`
      );

      // 2. ADD new item's reQty contribution (increment on new SKU)
      await db.collection("stock").updateOne(newStockFilter, {
        $inc: { reQty: newReQty }
      });
      await db.collection("items").updateOne(
        { sku: newSku },
        { $inc: { reQty: newReQty } }
      );

      console.log(
        `[ITEM CHANGE] New SKU: ${newSku} | Added reQty: ${newReQty}`
      );

      // 3. Update the order document with all new item fields
      const updatedOrder = await SellerOrder.findByIdAndUpdate(
        id,
        {
          itemId: updateData.itemId,
          itemName: updateData.itemName,
          category: updateData.category,
          unit: updateData.unit,
          sku: newSku,
          reQty: newReQty,
          rate: updateData.rate !== undefined ? Number(updateData.rate) : originalOrder.rate,
          totalAmount: updateData.totalAmount !== undefined ? Number(updateData.totalAmount) : newReQty * (originalOrder.rate || 0),
          firmCode: updateData.firmCode || originalOrder.firmCode,
          sellerId: updateData.sellerId || originalOrder.sellerId,
          instituteName: updateData.instituteName || originalOrder.instituteName,
          contractDate: updateData.contractDate !== undefined ? updateData.contractDate : originalOrder.contractDate,
          contractNo: updateData.contractNo !== undefined ? updateData.contractNo : originalOrder.contractNo,
          contractUrl: updateData.contractUrl !== undefined ? updateData.contractUrl : originalOrder.contractUrl,
          remark: updateData.remark !== undefined ? updateData.remark : originalOrder.remark,
        },
        { new: true }
      );

      console.log(
        `[ITEM CHANGE COMPLETE] Order: ${originalOrder.orderNo} | ${itemSku} → ${newSku} | reQty: ${oldReQty} → ${newReQty}`
      );

      // Sync PR counts for both old and new items
      try {
        await syncPurchaseRequest(db, itemSku);
        await syncPurchaseRequest(db, newSku);
      } catch (prErr) {
        console.error("[PR SYNC ERROR] Failed during item change sync:", prErr);
      }

      return NextResponse.json(updatedOrder, { status: 200 });
    }

    // ================================================================
    // LOGIC A: RETURN ORDER (WITH MOVE TO TO-CHECK FEATURE)
    // ================================================================
    if (updateData.status === "RETURN ORDER") {
      const returnQty = Number(updateData.reQty);

      // Get the base order number (removes any existing -1, -2, etc.)
      const baseOrderNo = originalOrder.orderNo.split('-')[0];
      const returnRecordCount = await SellerOrder.countDocuments({
        orderNo: { $regex: new RegExp(`^${escapeRegex(baseOrderNo)}-Re`) }
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
        totalAmount: returnQty * (originalOrder.rate || 0),
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
          totalAmount: returnQty * (originalOrder.rate || 0),
          status: "TO CHECK",
          orderNo: resubOrderNo,
          isPaid: false
        };
        await SellerOrder.create(toCheckOrderData);

        // Increase reQty (Pending Stock) for the new TO CHECK order using SKU
        await db.collection("stock").updateOne(stockFilter, { $inc: { reQty: returnQty } });
        await db.collection("items").updateOne({ sku: itemSku }, { $inc: { reQty: returnQty } });
      }

      // 3. Update or Delete the Original Order
      let updatedOriginal = null;
      if (updateData.isPartial) {
        const remainingQty = originalOrder.reQty - returnQty;
        updatedOriginal = await SellerOrder.findOneAndUpdate(
          { _id: id, reQty: originalOrder.reQty, status: originalOrder.status },
          {
            reQty: remainingQty,
            totalAmount: remainingQty * (originalOrder.rate || 0),
          },
          { new: true }
        );
        if (!updatedOriginal) {
          return NextResponse.json(
            { error: "This order has already been updated or processed by another action." },
            { status: 409 }
          );
        }
      } else {
        // If full return, delete or move original out of Delivery
        updatedOriginal = await SellerOrder.findOneAndDelete({
          _id: id,
          reQty: originalOrder.reQty,
          status: originalOrder.status
        });
        if (!updatedOriginal) {
          return NextResponse.json(
            { error: "This order has already been updated or processed by another action." },
            { status: 409 }
          );
        }
      }

      return NextResponse.json(updatedOriginal || { success: true }, { status: 200 });
    }

    // ================================================================
    // LOGIC C: PARTIAL READY TO SHIP (SPLIT ORDER)
    // ================================================================
    const shipQty = Number(updateData.shipQty);

    // Only enter this block if shipQty is LESS than total order qty
    if (
      (updateData.status === "READY TO SHIP" || updateData.status === "DELIVERY") &&
      updateData.isPartialFulfillment &&
      shipQty < originalOrder.reQty
    ) {
      const remainingQty = originalOrder.reQty - shipQty;

      // 1. GENERATE SEQUENTIAL ORDER NUMBER (P1, P2, etc.)
      const baseOrderNo = originalOrder.orderNo.split('-P')[0];
      const partialCount = await SellerOrder.countDocuments({
        orderNo: { $regex: new RegExp(`^${escapeRegex(baseOrderNo)}-P`) }
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
        totalAmount: shipQty * (originalOrder.rate || 0),
        status: updateData.status,
        orderNo: newOrderNo,
        ...(updateData.status === "DELIVERY" && {
          transportName: updateData.transportName || "",
          transportRemark: updateData.transportRemark || "",
          deliveryDate: updateData.deliveryDate || new Date().toISOString().split('T')[0]
        })
      };
      await SellerOrder.create(shippedOrderData);

      // 2. Update Original Order (Keep in TO CHECK with leftover qty)
      const updatedOriginal = await SellerOrder.findOneAndUpdate(
        { _id: id, reQty: originalOrder.reQty, status: "TO CHECK" },
        {
          reQty: remainingQty,
          totalAmount: remainingQty * (originalOrder.rate || 0),
        },
        { new: true }
      );
      if (!updatedOriginal) {
        return NextResponse.json(
          { error: "This order has already been updated or processed by another action." },
          { status: 409 }
        );
      }

      // 3. Deduct ONLY the shipped amount from stock collections via SKU
      await db.collection("stock").updateOne(stockFilter, {
        $inc: { quantity: -shipQty, reQty: -shipQty }
      });

      await db.collection("items").updateOne(
        { sku: itemSku },
        {
          $inc: { currentStock: -shipQty, reQty: -shipQty },
          $push: {
            history: {
              type: `PARTIAL SHIP by ${updateData.userName || "Admin"}`,
              qty: -shipQty,
              date: new Date(),
              orderNo: newOrderNo,
              sellerName: originalOrder.sellerName || originalOrder.instituteName || "N/A",
              otherDetails: `Split Order from To check to Ready to Ship. Order No: ${newOrderNo}`
            }
          } as any
        }
      );

      return NextResponse.json(updatedOriginal, { status: 200 });
    }

    // ================================================================
    // LOGIC B: STANDARD UPDATE (FULL STATUS CHANGE)
    // ================================================================

    // 1. STOCK CHECK: Only for full transitions to Ready to Ship
    if (updateData.activeTab === "TO CHECK" && updateData.status === "READY TO SHIP") {
      const orderQty = Number(updateData.shipQty || updateData.reQty || originalOrder.reQty || 0);

      const stockItem = await db.collection("stock").findOne(stockFilter);
      const available = stockItem?.quantity || 0;

      if (available < orderQty) {
        if (!updateData.shipQty) {
          return NextResponse.json(
            { error: `Insufficient Stock! Available: ${available}, Required: ${orderQty}.` },
            { status: 400 }
          );
        }
      }
    }

    if (updateData.status === "RETURN RECEIVED" && updateData.activeTab === "RETURN ORDER") {
      const returnQty = Number(updateData.reQty || originalOrder.reQty || 0);

      await db.collection("stock").updateOne(stockFilter, {
        $inc: { quantity: returnQty }
      });

      await db.collection("items").updateOne(
        { sku: itemSku },
        {
          $inc: { currentStock: returnQty },
          $push: {
            history: {
              type: `RETURN RECEIVED by ${updateData.userName || "Admin"}`,
              qty: returnQty,
              date: new Date(),
              orderNo: originalOrder.orderNo,
              sellerName: updateData.sellerName || originalOrder.instituteName || "N/A",
              otherDetails: `Item returned from ${originalOrder.orderNo}. Stock restored.`
            }
          } as any
        }
      );
    }

    // Perform the update once safely, guarding against concurrent double-clicks by matching the expected previous status
    const query: any = { _id: id };
    if (updateData.activeTab && updateData.activeTab !== "ALL") {
      query.status = updateData.activeTab;
    }
    const updated = await SellerOrder.findOneAndUpdate(query, { ...updateData }, { new: true });
    if (!updated) {
      console.warn(`🛑 Concurrent update blocked for order: ${originalOrder.orderNo}`);
      return NextResponse.json(
        { error: "This order has already been updated or processed by another action." },
        { status: 409 }
      );
    }
    const oldQty = Number(originalOrder.reQty || 0);
    const newQty = updateData.reQty !== undefined ? Number(updateData.reQty || 0) : oldQty;
    const qtyDifference = newQty - oldQty;

    if (qtyDifference !== 0) {
      if (originalOrder.status === "TO CHECK") {
        await db.collection("stock").updateOne(stockFilter, {
          $inc: { reQty: qtyDifference }
        });
        await db.collection("items").updateOne(
          { sku: itemSku },
          { $inc: { reQty: qtyDifference } }
        );
      } else if (originalOrder.status === "READY TO SHIP") {
        await db.collection("stock").updateOne(stockFilter, {
          $inc: { quantity: -qtyDifference }
        });
        await db.collection("items").updateOne(
          { sku: itemSku },
          { $inc: { currentStock: -qtyDifference } }
        );
      }
    }

    // Correctly reference original quantity configuration so full orders are calculated safely
    const adjustQty = Number(updated.reQty || originalOrder.reQty || 0);

    if (adjustQty > 0) {
      if (updateData.activeTab === "TO CHECK") {
        if (updateData.status === "READY TO SHIP") {
          await db.collection("stock").updateOne(stockFilter, {
            $inc: { reQty: -adjustQty, quantity: -adjustQty }
          });

          await db.collection("items").updateOne(
            { sku: itemSku },
            {
              $inc: { currentStock: -adjustQty, reQty: -adjustQty },
              $push: {
                history: {
                  type: `${updateData.status} by ${updateData.userName || "Admin"}`,
                  qty: -adjustQty,
                  date: new Date(),
                  orderNo: updated.orderNo,
                  sellerName: originalOrder.sellerName || originalOrder.instituteName || "N/A",
                  otherDetails: `Order confirmed so Stock deducted. It's from To Check to ${updateData.status}. `
                }
              } as any
            }
          );
        } else if (updateData.status === "HISAB" || updateData.status === "CANCELL ORDER" || updateData.status === "FULFILLED") {
          await db.collection("stock").updateOne(stockFilter, {
            $inc: { reQty: -adjustQty }
          });
          await db.collection("items").updateOne(
            { sku: itemSku },
            { $inc: { reQty: -adjustQty } }
          );
        }
      }
      else if (updateData.activeTab === "READY TO SHIP") {
        if (["HISAB", "CANCELL ORDER", "RETURN ORDER", "FULFILLED"].includes(updateData.status)) {
          await db.collection("stock").updateOne(stockFilter, {
            $inc: { quantity: adjustQty }
          });

          await db.collection("items").updateOne(
            { sku: itemSku },
            {
              $inc: { currentStock: adjustQty },
              $push: {
                history: {
                  type: `${updateData.status} by ${updateData.userName || "Admin"}`,
                  qty: adjustQty,
                  date: new Date(),
                  orderNo: updated.orderNo,
                  sellerName: updateData.sellerName || "N/A",
                  otherDetails: `Order moved from Ready to Ship to ${updateData.status}. Stock restored.`
                }
              } as any
            }
          );
        }
      }
      else if (updateData.activeTab === "CANCELL ORDER") {
        if (updateData.status === "TO CHECK") {
          await db.collection("stock").updateOne(stockFilter, {
            $inc: { reQty: adjustQty }
          });
          await db.collection("items").updateOne(
            { sku: itemSku },
            { $inc: { reQty: adjustQty } }
          );
        }
      }
      else if (updateData.activeTab === "HISAB") {
        if (updateData.status === "TO CHECK") {
          await db.collection("stock").updateOne(stockFilter, {
            $inc: { reQty: adjustQty }
          });
          await db.collection("items").updateOne(
            { sku: itemSku },
            { $inc: { reQty: adjustQty } }
          );
        }
      }
    }

    // Sync purchase request counts after order update
    try {
      await syncPurchaseRequest(db, itemSku);
    } catch (prErr) {
      console.error("[PR SYNC ERROR] Failed during standard update sync:", prErr);
    }

    return NextResponse.json(updated, { status: 200 });

  } catch (error: any) {
    console.error("PATCH Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ================================================================
// DELETE: Remove a "TO CHECK" order and recalculate stock reQty
// ================================================================
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const client = await clientPromise;
    const db = client.db("dev_oms_db");

    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGODB_URI as string);
    }

    // 1. Find the order first
    const order = await SellerOrder.findById(id);
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // 2. Only allow deletion of TO CHECK orders
    if (order.status !== "TO CHECK") {
      return NextResponse.json(
        { error: "Only orders in 'TO CHECK' status can be deleted." },
        { status: 400 }
      );
    }

    const itemSku = order.sku?.trim();
    const orderQty = Number(order.reQty || 0);

    // 3. Delete the order FIRST
    await SellerOrder.findByIdAndDelete(id);

    // 4. Recalculate reQty from ALL remaining TO CHECK orders for this SKU
    //    This prevents double-subtraction issues and guarantees accurate reQty
    if (itemSku) {
      const remainingOrders = await SellerOrder.aggregate([
        { $match: { sku: itemSku, status: "TO CHECK" } },
        { $group: { _id: null, totalReQty: { $sum: "$reQty" } } }
      ]);
      const correctReQty = remainingOrders[0]?.totalReQty || 0;

      // Set reQty to the exact correct value (not $inc)
      await db.collection("stock").updateOne(
        { sku: itemSku },
        { $set: { reQty: correctReQty } }
      );

      // Parse userName from query string (passed by frontend)
      const url = new URL(req.url);
      const userName = url.searchParams.get("userName") || "Admin";

      await db.collection("items").updateOne(
        { sku: itemSku },
        {
          $set: { reQty: correctReQty },
          $push: {
            history: {
              type: `ORDER DELETED by ${userName}`,
              qty: -orderQty,
              date: new Date(),
              orderNo: order.orderNo,
              sellerName: order.instituteName || "N/A",
              otherDetails: `TO CHECK order ${order.orderNo} removed. reQty recalculated to ${correctReQty}.`
            }
          } as any
        }
      );
      // Sync PR counts after order deletion
      try {
        await syncPurchaseRequest(db, itemSku);
      } catch (prErr) {
        console.error("[PR SYNC ERROR] Failed during delete sync:", prErr);
      }
    }

    return NextResponse.json(
      { success: true, message: `Order ${order.orderNo} deleted and stock updated.` },
      { status: 200 }
    );

  } catch (error: any) {
    console.error("DELETE Error:", error);
    return NextResponse.json({ error: "Failed to delete order." }, { status: 500 });
  }
}