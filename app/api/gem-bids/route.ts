import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

// GET: every stored bid (client filters/sorts/paginates per section — same convention as
// the Orders board, no server-side pagination anywhere else in this app either).
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const bids = await db.collection("gem_bids").find({}).sort({ updatedAt: -1 }).toArray();
    return NextResponse.json(bids);
  } catch (error: any) {
    console.error("GeM bids GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch bids" }, { status: 500 });
  }
}
