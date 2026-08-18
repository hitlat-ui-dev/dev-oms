import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

const DB_NAME = "dev_oms_db";

// GET: current state of a sync run (polled every ~2s by the GeM Bids page to
// drive the live red progress bar). ?runId= for a specific run, or omitted to
// get the most recent run of any status (so the page can tell on load whether
// a run is currently active or was left stopped).
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const runId = searchParams.get("runId");

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const runsCollection = db.collection("gem_bid_sync_runs");

    const run = runId && ObjectId.isValid(runId)
      ? await runsCollection.findOne({ _id: new ObjectId(runId) })
      : await runsCollection.findOne({}, { sort: { startedAt: -1 } });

    if (!run) return NextResponse.json({ run: null });

    return NextResponse.json({ run: { ...run, _id: run._id.toString() } });
  } catch (error: any) {
    console.error("GeM bid sync status error:", error);
    return NextResponse.json({ error: error.message || "Failed to load sync status" }, { status: 500 });
  }
}
