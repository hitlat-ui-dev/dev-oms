import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

const DB_NAME = "dev_oms_db";

// A batched apply (see applyImport.ts) should never take more than a few
// seconds even for a huge state-wide scan - if a run is still "applying"
// past this, the serverless function that was running it almost certainly
// got killed by the platform's execution limit mid-batch (a hard kill, so
// the apply route's own try/catch never got to run and flip the status
// itself). Self-heals here instead of leaving the Stop Sync button stuck
// forever - "scraping" gets no such timeout, since a real multi-city/page
// scan can legitimately run long.
const STUCK_APPLYING_MS = 5 * 60 * 1000;

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

    let run = runId && ObjectId.isValid(runId)
      ? await runsCollection.findOne({ _id: new ObjectId(runId) })
      : await runsCollection.findOne({}, { sort: { startedAt: -1 } });

    if (!run) return NextResponse.json({ run: null });

    if (run.status === "applying") {
      const since = run.applyingSince ? new Date(run.applyingSince).getTime() : new Date(run.startedAt).getTime();
      if (Date.now() - since > STUCK_APPLYING_MS) {
        await runsCollection.updateOne(
          { _id: run._id },
          { $set: { status: "failed", finishedAt: new Date(), failReason: "Apply timed out server-side (stuck past 5 minutes)" } }
        );
        run = { ...run, status: "failed", finishedAt: new Date() };
      }
    }

    return NextResponse.json({ run: { ...run, _id: run._id.toString() } });
  } catch (error: any) {
    console.error("GeM bid sync status error:", error);
    return NextResponse.json({ error: error.message || "Failed to load sync status" }, { status: 500 });
  }
}
