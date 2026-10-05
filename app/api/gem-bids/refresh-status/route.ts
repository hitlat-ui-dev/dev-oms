import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// POST — queues every bid currently in Submitted Bids for a GeM status
// re-check (statusRefresh.status: "pending"), picked up by the extension's
// background worker the same way Start Sync/Fetch Bid Documents are -
// polled via GET below. The actual GeM-side lookup (where/how "current
// status" is read for a submitted bid) isn't wired into the extension yet;
// this queues cleanly either way so it's ready the moment that part lands.
export async function POST() {
  try {
    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const bidsCollection = db.collection("gem_bids");

    const now = new Date();
    const result = await bidsCollection.updateMany(
      { currentSection: "submitted_bids" },
      { $set: { statusRefresh: { status: "pending", requestedAt: now, finishedAt: null, error: null } } }
    );

    return NextResponse.json({ queuedCount: result.modifiedCount || 0 }, { headers: corsHeaders });
  } catch (error: any) {
    console.error("GeM bid refresh-status POST error:", error);
    return NextResponse.json({ error: error.message || "Failed to queue status refresh" }, { status: 500, headers: corsHeaders });
  }
}

// GET — returns up to 20 bids still pending a status check, for the
// extension's background worker to claim and work through a few at a time
// (flips each to "fetching" in the same query so a second poll before this
// batch finishes doesn't hand out the same bids twice).
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const bidsCollection = db.collection("gem_bids");

    const pending = await bidsCollection
      .find({ "statusRefresh.status": "pending" }, { projection: { bidNo: 1, bidLink: 1 } })
      .sort({ "statusRefresh.requestedAt": 1 })
      .limit(20)
      .toArray();

    if (pending.length === 0) return NextResponse.json({ bids: [] }, { headers: corsHeaders });

    await bidsCollection.updateMany(
      { _id: { $in: pending.map((b) => b._id) } },
      { $set: { "statusRefresh.status": "fetching" } }
    );

    return NextResponse.json(
      { bids: pending.map((b) => ({ _id: b._id.toString(), bidNo: b.bidNo, bidLink: b.bidLink || "" })) },
      { headers: corsHeaders }
    );
  } catch (error: any) {
    console.error("GeM bid refresh-status GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to claim status refresh batch" }, { status: 500, headers: corsHeaders });
  }
}
