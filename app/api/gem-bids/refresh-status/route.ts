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
// polled via GET below. batchId (this call's own timestamp) tags every bid
// queued in this one request, so .../progress below can report "how far
// through THIS run" rather than being confused by leftover done/failed
// bids from an earlier refresh that happened to still match a looser
// query - GemBidTable polls that endpoint with this id to show live
// progress instead of the fire-and-forget "queued" alert this used to be.
export async function POST() {
  try {
    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const bidsCollection = db.collection("gem_bids");

    const now = new Date();
    const batchId = now.getTime().toString();
    const result = await bidsCollection.updateMany(
      { currentSection: "submitted_bids" },
      { $set: { statusRefresh: { status: "pending", requestedAt: now, finishedAt: null, error: null, batchId } } }
    );

    return NextResponse.json({ queuedCount: result.modifiedCount || 0, batchId }, { headers: corsHeaders });
  } catch (error: any) {
    console.error("GeM bid refresh-status POST error:", error);
    return NextResponse.json({ error: error.message || "Failed to queue status refresh" }, { status: 500, headers: corsHeaders });
  }
}

// A bid stuck at "fetching" past this (the GeM tab never opened, the
// extension crashed mid-batch, the tab got closed by hand, etc. - any path
// that claims a bid but never reaches /complete for it) is reclaimed back
// to "pending" here so the next poll retries it, instead of sitting stuck
// forever - the exact bug behind "the button just shows running and
// nothing ever finishes".
const STUCK_FETCHING_MS = 3 * 60 * 1000;

// GET — returns up to 20 bids still pending a status check, for the
// extension's background worker to claim and work through a few at a time
// (flips each to "fetching" in the same query so a second poll before this
// batch finishes doesn't hand out the same bids twice).
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const bidsCollection = db.collection("gem_bids");

    await bidsCollection.updateMany(
      {
        "statusRefresh.status": "fetching",
        "statusRefresh.requestedAt": { $lt: new Date(Date.now() - STUCK_FETCHING_MS) },
      },
      { $set: { "statusRefresh.status": "pending" } }
    );

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
