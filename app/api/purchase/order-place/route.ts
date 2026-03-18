import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db();

    // Fetching from the new collection name you specified
    const orders = await db
      .collection("Order place Purchase")
      .find({})
      .sort({ createdAt: -1 }) // -1 ensures newest orders are at the top
      .toArray();

    return NextResponse.json(orders);
  } catch (error: any) {
    console.error("Fetch Orders Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch orders" }, 
      { status: 500 }
    );
  }
}