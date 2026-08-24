import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

async function fetchWithDetails(db: any, collectionName: string) {
  return await db.collection(collectionName).aggregate([
    {
      $lookup: {
        from: "stock", // Primary lookups directly from active stock collection
        let: { searchId: "$itemId", searchName: "$itemName" },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  { $eq: ["$_id", { $toObjectId: "$$searchId" }] },
                  { $eq: ["$_id", "$$searchId"] },
                  { $eq: ["$itemId", "$$searchId"] },
                  // Name fallback only - a hidden/retired item can share the
                  // exact same itemName as its active replacement, and this
                  // $or has no way to prefer an id match over a name match
                  // (array order isn't guaranteed), so excluding hidden here
                  // stops it from ever winning over the real active item.
                  { $and: [{ $eq: ["$itemName", "$$searchName"] }, { $ne: ["$hidden", true] }] }
                ]
              }
            }
          }
        ],
        as: "masterDetails"
      }
    },
    {
      // Fallback lookup against legacy items collection if stock lookup yields no match
      $lookup: {
        from: "items",
        let: { searchId: "$itemId", searchName: "$itemName" },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  { $eq: ["$_id", { $toObjectId: "$$searchId" }] },
                  { $eq: ["$_id", "$$searchId"] },
                  { $eq: ["$itemId", "$$searchId"] },
                  { $and: [{ $eq: ["$itemName", "$$searchName"] }, { $ne: ["$hidden", true] }] }
                ]
              }
            }
          }
        ],
        as: "fallbackDetails"
      }
    },
    {
      $addFields: {
        masterRecord: {
          $cond: {
            if: { $gt: [{ $size: "$masterDetails" }, 0] },
            then: { $arrayElemAt: ["$masterDetails", 0] },
            else: { $arrayElemAt: ["$fallbackDetails", 0] }
          }
        }
      }
    },
    {
      $addFields: {
        category: { $ifNull: ["$masterRecord.category", "$category", "GENERAL"] },
        location: { $ifNull: ["$masterRecord.location", "$location", "N/A"] },
        sku: { $ifNull: ["$masterRecord.sku", "$sku", "N/A"] }
      }
    },
    { 
      $project: { 
        masterDetails: 0, 
        fallbackDetails: 0, 
        masterRecord: 0 
      } 
    }
  ]).toArray();
}

// --- GET: Fetch all Purchase Records ---
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db();

    const [prData, orderData, receivedData] = await Promise.all([
      fetchWithDetails(db, "purchase_requests"),
      fetchWithDetails(db, "orders"),
      fetchWithDetails(db, "Received purchase"),
    ]);

    return NextResponse.json([...prData, ...orderData, ...receivedData]);
  } catch (error: any) {
    return NextResponse.json([]);
  }
}

// --- POST: Create a New Purchase Request ---
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { itemId, itemName, prQty, unit, remark } = body;

    const client = await clientPromise;
    const db = client.db();

    let queryId: any = itemId;
    try {
      if (itemId && typeof itemId === "string" && itemId.length === 24) {
        queryId = new ObjectId(itemId);
      }
    } catch (e) {
      // Safe fallback if parsing non-standard structures
    }

    // Step 1: Check primary active data collection (stock) by id only - a
    // hidden/retired item is often kept around sharing the exact same
    // itemName as its active replacement (see app/api/items/route.ts's
    // duplicate-name check), so mixing an itemName match into this $or
    // risked resolving to the wrong (retired) one even when a correct
    // itemId was already supplied (confirmed live: sent a Purchase Request
    // to a hidden SKU while the order it came from used the active one).
    const idConditions: any[] = [];
    if (queryId) idConditions.push({ _id: queryId });
    if (itemId) {
      idConditions.push({ _id: String(itemId) });
      idConditions.push({ itemId: String(itemId) });
    }

    let masterItem = idConditions.length
      ? await db.collection("stock").findOne({ $or: idConditions })
      : null;

    // Step 2: Fallback query checking legacy catalog collection (items)
    if (!masterItem && idConditions.length) {
      masterItem = await db.collection("items").findOne({ $or: idConditions });
    }

    // Step 3: only when no id resolved at all (e.g. a legacy caller that
    // never had an itemId to send) fall back to matching by name - hidden
    // items are excluded so this can never silently pick a retired
    // duplicate over its active replacement.
    if (!masterItem && itemName) {
      masterItem = await db.collection("stock").findOne({ itemName: String(itemName), hidden: { $ne: true } });
      if (!masterItem) {
        masterItem = await db.collection("items").findOne({ itemName: String(itemName), hidden: { $ne: true } });
      }
    }

    // Airtight validation guard statement
    const finalSku = masterItem?.sku || "N/A";
    if (!masterItem || finalSku === "N/A" || finalSku.trim() === "") {
      return NextResponse.json(
        { error: "Item lookup validation failed. Missing valid SKU code." },
        { status: 400 }
      );
    }

    const newRequest = {
      itemId: itemId,
      itemName: masterItem.itemName || itemName,
      sku: masterItem.sku,
      category: masterItem.category || "GENERAL",
      prQty: Number(prQty),
      unit: unit || masterItem.unit || "NOS",
      remark: remark || "",
      status: "Purchase Request",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection("purchase_requests").insertOne(newRequest);
    return NextResponse.json({ success: true, id: result.insertedId }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}