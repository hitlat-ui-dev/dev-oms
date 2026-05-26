import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

export async function PUT(request) {
  try {
    // 1. Connect to MongoDB using clientPromise
    const client = await clientPromise;
    const db = client.db(); 

    // 2. Parse payload data from the client form
    const { sku, quantityInput, historyType } = await request.json();

    if (!sku || !quantityInput) {
      return NextResponse.json({ error: "Missing SKU or Quantity values" }, { status: 400 });
    }

    const qtyChange = parseInt(quantityInput, 10);
    const currentTimestamp = new Date().toISOString();

    // 3. Determine if we add or remove units based on history log message
    let stockModifier = qtyChange;
    if (historyType === "Stock Remove" || historyType === "Damage") {
      stockModifier = -qtyChange;
    }

    // 4. Update the "items" collection
    // Uses an aggregation pipeline update to increment stock safely while preventing values < 0
    const itemUpdateResult = await db.collection("items").findOneAndUpdate(
      { sku: sku },
      [
        {
          $set: {
            currentStock: {
              $max: [0, { $add: [{ $ifNull: ["$currentStock", 0] }, stockModifier] }]
            },
            updatedAt: currentTimestamp,
            // Appends the new action to the history array or creates it if it doesn't exist
            history: {
              $concatArrays: [
                { $ifNull: ["$history", []] },
                [{ type: historyType, qty: qtyChange, date: currentTimestamp }]
              ]
            }
          }
        }
      ],
      { returnDocument: "after" } 
    );

    // If item doesn't exist in the "items" collection, exit early
    if (!itemUpdateResult) {
      return NextResponse.json({ error: `SKU: ${sku} not found inside items collection` }, { status: 404 });
    }

    // 5. Update the "stock" collection
    // Keeps quantity in sync and guarantees it won't fall below 0
    await db.collection("stock").findOneAndUpdate(
      { sku: sku },
      [
        {
          $set: {
            quantity: {
              $max: [0, { $add: [{ $ifNull: ["$quantity", 0] }, stockModifier] }]
            },
            createdAt: currentTimestamp
          }
        }
      ]
    );

    return NextResponse.json({
      success: true,
      message: `Successfully processed "${historyType}" for SKU: ${sku}`
    });

  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}