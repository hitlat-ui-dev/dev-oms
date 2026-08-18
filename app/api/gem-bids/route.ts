import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// GET: every stored bid (client filters/sorts/paginates per section — same convention as
// the Orders board, no server-side pagination anywhere else in this app either).
// ?light=1 returns just {_id, bidNo} - the Bid Document Maker page only ever
// needs bid numbers to populate its search dropdown, not full bid documents.
// ?section=<key> narrows to one section server-side - used by the sync bridge to
// fetch just the Submitted Bids bidNos it needs to status-check, without pulling
// every bid over the wire for that.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const light = searchParams.get("light");
    const section = searchParams.get("section");

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const query = section ? { currentSection: section } : {};
    const bids = await db
      .collection("gem_bids")
      .find(query, light ? { projection: { bidNo: 1 } } : undefined)
      .sort({ updatedAt: -1 })
      .toArray();
    return NextResponse.json(bids, { headers: corsHeaders });
  } catch (error: any) {
    console.error("GeM bids GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch bids" }, { status: 500, headers: corsHeaders });
  }
}

// DELETE: remove one or more bids permanently, by Bid No. Available on every
// section (New Bids and Submitted Bids included) - change/move history rows
// for a deleted bid are kept as an audit trail, only the live gem_bids doc goes.
export async function DELETE(req: Request) {
  try {
    const body = await req.json();
    const { bidNos } = body;
    if (!Array.isArray(bidNos) || bidNos.length === 0) {
      return NextResponse.json({ error: "bidNos are required" }, { status: 400, headers: corsHeaders });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const result = await db.collection("gem_bids").deleteMany({ bidNo: { $in: bidNos } });

    return NextResponse.json({ success: true, deletedCount: result.deletedCount || 0 }, { headers: corsHeaders });
  } catch (error: any) {
    console.error("GeM bids DELETE error:", error);
    return NextResponse.json({ error: error.message || "Delete failed" }, { status: 500, headers: corsHeaders });
  }
}
