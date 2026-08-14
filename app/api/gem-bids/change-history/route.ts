import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

// GET: per-field change log for one bid, newest first.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const bidNo = searchParams.get("bidNo");
    if (!bidNo) return NextResponse.json({ error: "bidNo is required" }, { status: 400 });

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const rows = await db.collection("gem_bid_change_history").find({ bidNo }).sort({ runTimestamp: -1 }).toArray();
    return NextResponse.json(rows);
  } catch (error: any) {
    console.error("GeM bid change-history GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch change history" }, { status: 500 });
  }
}
