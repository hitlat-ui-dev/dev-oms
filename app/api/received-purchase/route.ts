import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

export async function POST(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");
    const body = await req.json();

    const {
      originalOrderId,
      itemId,
      itemName,
      receivedQty,
      damageQty,
      orderQty,
      sku,
      moveRemainingTo,
      vendor,
      unit,
      rate,
      category,
      orderNumber,
      userName
    } = body;

    const remainingQty = Number(orderQty) - Number(receivedQty) - Number(damageQty);

    const itemFilter = itemId ? { _id: new ObjectId(itemId) } : { sku: sku };

    // 1. SAVE TO STOCK (Only increment by received quantity)
    // Matched by itemId when available (same as the items-collection update
    // below) rather than sku alone - sku isn't guaranteed unique across
    // stock documents (real data has had duplicates), and a sku-only match
    // can silently update the wrong item's stock record instead of this
    // purchase's actual item.
    await db.collection("stock").updateOne(
      itemFilter,
      {
        $inc: { quantity: Number(receivedQty) },
        $set: { itemName, vendor, unit, rate, category, lastUpdated: new Date() }
      },
      { upsert: false } // CHANGE: Set to false so it doesn't create a second item
    );

    // --- INSERT START: UPDATE LEDGER HISTORY ---
    await db.collection("items").updateOne(
      itemFilter, 
      {
        $inc: { currentStock: Number(receivedQty) },
        $push: {
          history: {
            type: `PURCHASE Received by ${userName || "Admin"}`,
            qty: Number(receivedQty),
            date: new Date(),
            vendorName: vendor,
            orderNo: orderNumber,
            rate: rate ? Number(rate) : undefined
          }
        }
      } as any,
      { upsert: false } // CHANGE: Set to false to prevent duplicates here too
    );

    // // Log Damage as a Return in History
    // if (Number(damageQty) > 0) {
    //   await db.collection("items").updateOne(
    //     { sku: sku },
    //     {
    //       $push: {
    //         history: {
    //           type: 'Damage PURCHASE RETURN',
    //           qty: -Number(damageQty), // Negative qty will show in the "Debit" column
    //           date: new Date(),
    //           vendorName: vendor,
    //           orderNo: orderNumber
    //         }
    //       }
    //     } as any
    //   );
    // }
    // // --- INSERT END ---

    // 2. SAVE TO RECEIVED PURCHASE (Log History)
    await db.collection("Received purchase").insertOne({
      orderNumber,
      itemId: itemId || null,
      itemName,
      sku,
      receivedQty: Number(receivedQty),
      damageQty: Number(damageQty),
      unit,
      vendor,
      rate,
      receivedAt: new Date()
    });

    // --- NEW SECTION: SAVE TO PURCHASE RETURN ---
    if (Number(damageQty) > 0) {
      await db.collection("Purchase Return").insertOne({
        originalOrderNumber: orderNumber,
        itemName,
        sku,
        vendor,
        returnQty: Number(damageQty),
        unit,
        rate: Number(rate),
        totalReturnAmount: Number(damageQty) * Number(rate),
        reason: "Damaged during delivery",
        status: "Pending", // You can use this for tracking credit notes
        createdAt: new Date()
      });
    }
    // --------------------------------------------

    // 3. HANDLE REMAINING QTY
    if (remainingQty > 0) {
      const targetCollection = moveRemainingTo === "Purchase Request"
        ? "purchase_requests"
        : "Order place Purchase";

      const remainingData: any = {
        itemName,
        itemId,
        sku,
        category,
        prQty: remainingQty,
        orderQty: remainingQty,
        unit,
        vendor,
        rate,
        status: moveRemainingTo === "Purchase Request" ? "pending" : "Order Place",
        createdAt: new Date()
      };

      if (moveRemainingTo === "Order Place") {
        remainingData.orderNumber = orderNumber;
      }

      await db.collection(targetCollection).insertOne(remainingData);
    }

    // 4. DELETE THE ORIGINAL ORDER
    await db.collection("Order place Purchase").deleteOne({ _id: new ObjectId(originalOrderId) });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Receive Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");
    const { id, receivedQty, rate, userName } = await req.json();

    if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });

    // 1. Find the existing record to get the old values
    // Note: Ensure your collection name is consistent (you used "Received purchase" in POST)
    const existingRecord = await db.collection("Received purchase").findOne({
      _id: new ObjectId(id)
    });

    if (!existingRecord) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    const oldQty = Number(existingRecord.receivedQty || 0);
    const newQty = Number(receivedQty);
    const qtyDifference = newQty - oldQty; // e.g., 55 - 50 = +5

    // 2. Update the "Received purchase" log
    const updateResult = await db.collection("Received purchase").updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          receivedQty: newQty,
          rate: Number(rate)
        }
      }
    );

    // 3. Sync with STOCK DB
    // Use $inc with the difference (qtyDifference). Matched by itemId when
    // the original record has one - sku isn't guaranteed unique across
    // stock documents (real data has had duplicates), and a sku-only match
    // can silently update the wrong item's stock record.
    const editItemFilter = existingRecord.itemId
      ? { _id: new ObjectId(existingRecord.itemId) }
      : { sku: existingRecord.sku };
    await db.collection("stock").updateOne(
      editItemFilter,
      {

        $inc: { quantity: qtyDifference },
        $set: { rate: Number(rate), lastUpdated: new Date() }
      }
    );
    // --- CHANGE: ITEM LEDGER UPDATE ---
    if (existingRecord.sku) {
      await db.collection<any>("items").updateOne(
        { sku: existingRecord.sku },
        {
          // 1. Still update the main stock balance
          $inc: { currentStock: qtyDifference },

          // 2. Add a BRAND NEW entry to show the edit history
          $push: {
            history: {
              type: `EDIT_PURCHASE by ${userName || "Admin"}`,
              qty: qtyDifference,    // Just the change (e.g., +5 or -5)
              date: new Date(),
              orderNo: existingRecord.orderNumber,
              otherDetails: `Qty adjusted from ${oldQty} to ${newQty}`
            }
          }as any
        }
      );
    }

    return NextResponse.json({
      success: true,
      newTotalReceived: newQty,
      stockAdjustedBy: qtyDifference
    });

  } catch (error: any) {
    console.error("Update Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}