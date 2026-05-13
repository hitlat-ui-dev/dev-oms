import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

async function fetchWithDetails(db: any, collectionName: string) {
  const data = await db.collection(collectionName).aggregate([
    {
      $lookup: {
        from: "items",
        localField: "itemName",
        foreignField: "itemName",
        as: "masterDetails"
      }
    },
    {
      $addFields: {
        category: { $arrayElemAt: ["$masterDetails.category", 0] },
        location: { $arrayElemAt: ["$masterDetails.location", 0] },
        sku: { $arrayElemAt: ["$masterDetails.sku", 0] },
        // DEBUG FIELD: Let us see if masterDetails actually found something
        hasMasterMatch: { $gt: [{ $size: "$masterDetails" }, 0] }
      }
    },
    { $project: { masterDetails: 0 } }
  ]).toArray();

  // --- CONSOLE LOG FOR GET ---
  console.log(`--- DEBUG GET: ${collectionName} ---`);
  if (data.length > 0) {
    console.log("First Item Example:", {
      name: data[0].itemName,
      sku: data[0].sku,
      category: data[0].category,
      matchFound: data[0].hasMasterMatch
    });
  }
  return data;
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

    const allRequests = [...prData, ...orderData, ...receivedData];
    return NextResponse.json(allRequests);
  } catch (error: any) {
    console.error("GET API CRASHED:", error);
    return NextResponse.json([]);
  }
}

// --- POST: Create a New Purchase Request ---
export async function POST(req: Request) {
  try {
    const body = await req.json();
    // Use itemId instead of name for the primary search
    const { itemId, itemName, prQty, unit, remark } = body;

    const client = await clientPromise;
    const db = client.db();

    // 1. Find the master item by its unique ID
    // We check both _id and itemId fields to be safe
    const masterItem = await db.collection("items").findOne({
      $or: [
        { _id: itemId }, 
        { itemId: itemId }
      ]
    });

    const newRequest = {
      // Save the specific ID so the GET join is perfect
      itemId: itemId, 
      itemName: masterItem ? masterItem.itemName : itemName,
      sku: masterItem ? masterItem.sku : "N/A",
      category: masterItem ? masterItem.category : "GENERAL",
      prQty: Number(prQty),
      unit: unit || masterItem?.unit || "NOS",
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