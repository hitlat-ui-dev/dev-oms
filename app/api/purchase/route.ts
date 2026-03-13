import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// --- GET: Fetch all Purchase Records ---
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db();

    // Fetch from all three collections in parallel
    const [prData, orderData, receivedData] = await Promise.all([
      db.collection("purchase_requests").find({}).toArray(),
      db.collection("orders").find({}).toArray(),
      db.collection("Received purchase").find({}).toArray(),
    ]);

    // Combine them into one array for your state
    const allRequests = [...prData, ...orderData, ...receivedData];

    return NextResponse.json(allRequests);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
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

    const newRequest = {
      itemName: itemName.toUpperCase(),
      prQty: Number(prQty),           // Ensuring it's a number
      unit: unit || "units",
      remark: remark || "",           // CHANGE 3: Added remark to the DB object
      status: "Purchase Request",     // Default starting status
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