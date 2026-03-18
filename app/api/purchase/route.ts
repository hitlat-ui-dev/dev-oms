import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";


async function fetchWithDetails(db: any, collectionName: string) {
  return await db.collection(collectionName).aggregate([
    {
      $lookup: {
        from: "items",           // Your master items collection
        localField: "itemName",  // Field in purchase/order/received
        foreignField: "itemName", // Field in items DB
        as: "masterDetails"
      }
    },
    {
      $addFields: {
        category: { $arrayElemAt: ["$masterDetails.category", 0] },
        location: { $arrayElemAt: ["$masterDetails.location", 0] },
        sku: { $arrayElemAt: ["$masterDetails.sku", 0] }
      }
    },
    {
      $project: { masterDetails: 0 } // Remove the temporary join array
    }
  ]).toArray();
}
// --- GET: Fetch all Purchase Records ---
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db();

    // Fetch from all three collections with the JOIN logic applied
    const [prData, orderData, receivedData] = await Promise.all([
      fetchWithDetails(db, "purchase_requests"),
      fetchWithDetails(db, "orders"),
      fetchWithDetails(db, "Received purchase"),
    ]);

    // Combine into one array. Frontend .filter(r => r.status === "...") still works.
    const allRequests = [...prData, ...orderData, ...receivedData];

    return NextResponse.json(allRequests);
  } catch (error: any) {
    //console.error("GET Error:", error);
    // Return empty array on error so frontend .filter() doesn't crash
    return NextResponse.json([]);
  }
}

// --- POST: Create a New Purchase Request ---
export async function POST(req: Request) {
  try {
    const body = await req.json();

    /**
     * CHANGE 1: Destructure 'prQty' and 'remark' from the body.
     * CHANGE 2: Removed 'department' and 'priority' from destructuring.
     */
    const { itemName, prQty, unit, remark } = body;

    // Basic validation (Check prQty instead of qty)
    if (!itemName || !prQty) {
      return NextResponse.json(
        { error: "Item name and PR quantity are required" },
        { status: 400 }
      );
    }

    const client = await clientPromise;
    const db = client.db();

    const masterItem = await db.collection("items").findOne({
      itemName: { $regex: new RegExp(`^${itemName.trim()}$`, "i") }
    });

    console.log("Master Item Found:", masterItem);

    const newRequest = {
      itemName: itemName.toUpperCase(),
      prQty: Number(prQty),           // Ensuring it's a number
      unit: unit || "units",
      remark: remark || "",           // CHANGE 3: Added remark to the DB object
      status: "Purchase Request",     // Default starting status
      category: masterItem?.category || "General",
      //location: masterItem?.location || "---",
      location: masterItem?.location || "NOT SET",
      sku: masterItem?.sku || "N/A",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection("purchase_requests").insertOne(newRequest);

    return NextResponse.json({
      success: true,
      id: result.insertedId
    }, { status: 201 });

  } catch (error: any) {
    console.error("POST Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}