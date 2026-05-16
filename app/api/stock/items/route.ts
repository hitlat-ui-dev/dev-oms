import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// Force Next.js to fetch live data every time, preventing empty cache states
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db();

    console.log("--- DEBUG: API STOCK ITEMS START ---");
    
    // Fetch directly from your master items collection
    const items = await db
      .collection("items")
      .find({})
      .sort({ sku: 1 }) 
      .toArray();

    console.log(`--- DEBUG: Found ${items.length} items in the DB ---`);
    if (items.length > 0) {
      console.log("Sample Item:", items[0]);
    }

    return NextResponse.json(items);
  } catch (error: any) {
    console.error("Master Items Route Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}