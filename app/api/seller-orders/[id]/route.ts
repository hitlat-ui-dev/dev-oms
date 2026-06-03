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

    // Safely extract the structural keys straight from the MongoDB source
    const itemSku = originalOrder.sku?.trim();
    if (!itemSku) {
      return NextResponse.json({ error: "Order record is missing a SKU code." }, { status: 400 });
    }

    // Define bulletproof stock query filter using the item SKU code
    const stockFilter = { sku: itemSku };

    // ================================================================
    // LOGIC A: RETURN ORDER (WITH MOVE TO TO-CHECK FEATURE)
    // ================================================================
    if (updateData.status === "RETURN ORDER") {
      const returnQty = Number(updateData.reQty);

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
        updatedOriginal = await SellerOrder.findByIdAndUpdate(
          id,
          {
            reQty: remainingQty,
            totalAmount: remainingQty * (originalOrder.rate || 0),
          },
          { new: true }
        );
      } else {
        // If full return, delete or move original out of Delivery
        updatedOriginal = await SellerOrder.findByIdAndDelete(id);
      }

      return NextResponse.json(updatedOriginal || { success: true }, { status: 200 });
    }

    // ================================================================
    // LOGIC C: PARTIAL READY TO SHIP (SPLIT ORDER)
    // ================================================================
    const shipQty = Number(updateData.shipQty);

    // Only enter this block if shipQty is LESS than total order qty
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
        totalAmount: shipQty * (originalOrder.rate || 0),
        status: "READY TO SHIP",
        orderNo: newOrderNo,
      };
      await SellerOrder.create(shippedOrderData);

      // 2. Update Original Order (Keep in TO CHECK with leftover qty)
      const updatedOriginal = await SellerOrder.findByIdAndUpdate(
        id,
        {
          reQty: remainingQty,
          totalAmount: remainingQty * (originalOrder.rate || 0),
        },
        { new: true }
      );

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

    // Perform the update once safely
    const updated = await SellerOrder.findByIdAndUpdate(id, { ...updateData }, { new: true });
    const oldQty = Number(originalOrder.reQty || 0);
    const newQty = Number(updateData.reQty || 0);
    const qtyDifference = newQty - oldQty;

    if (qtyDifference !== 0) {
      await db.collection("stock").updateOne(stockFilter, {
        $inc: { reQty: qtyDifference }
      });
    }

    // Correctly reference original quantity configuration so full orders are calculated safely
    const adjustQty = Number(originalOrder.reQty || updated.reQty || 0);

    if (adjustQty > 0) {
      if (updateData.activeTab === "TO CHECK") {
        if (updateData.status === "READY TO SHIP") {
          await db.collection("stock").updateOne(stockFilter, {
            $inc: { reQty: -adjustQty, quantity: -adjustQty }
          });

          await db.collection("items").updateOne(
            { sku: itemSku },
            {
              $inc: { currentStock: -adjustQty, reQty: -shipQty },
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

    return NextResponse.json(updated, { status: 200 });

  } catch (error: any) {
    console.error("PATCH Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}