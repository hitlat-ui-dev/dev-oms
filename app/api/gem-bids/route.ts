import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

// GET: every stored bid (client filters/sorts/paginates per section — same convention as
// the Orders board, no server-side pagination anywhere else in this app either).
// ?light=1 returns just {_id, bidNo} - the Bid Document Maker page only ever
// needs bid numbers to populate its search dropdown, not full bid documents.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const light = searchParams.get("light");

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const bids = await db
      .collection("gem_bids")
      .find({}, light ? { projection: { bidNo: 1 } } : undefined)
      .sort({ updatedAt: -1 })
      .toArray();
    return NextResponse.json(bids);
  } catch (error: any) {
    console.error("GeM bids GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch bids" }, { status: 500 });
  }
}
