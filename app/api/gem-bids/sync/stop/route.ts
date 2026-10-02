import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

const DB_NAME = "dev_oms_db";

// POST: mark a run stopped. body: { runId }
// This only flips the DB state to "stopped" — in Phase 1 (no extension bridge
// yet) there's nothing running server-side to actually kill. Once the bridge
// exists (Phase 2), the extension's background worker polls this run's status
// between scan steps and halts when it sees "stopped", so setting this flag IS
// the kill signal from the OMS side; whatever was scraped up to that point
// stays parked in the extension's local storage rather than being applied.
//
// Also doubles as the recovery path for a run wedged in "applying": the apply
// route's serverless function can get killed by its execution time limit
// mid-batch (large batches used to mean one sequential findOne+insert/update
// per bid — see applyImport.ts), which leaves status stuck at "applying"
// forever with nothing left to un-wedge it. Letting Stop Sync clear that too
// means the button the user already has is the fix, instead of a manual DB
// edit. bidNo is the import's dedup key, so re-running Start Sync after a
// stuck run is cleared safely re-applies anything that didn't make it in.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { runId } = body;
    if (!runId || !ObjectId.isValid(runId)) {
      return NextResponse.json({ error: "runId is required" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const runsCollection = db.collection("gem_bid_sync_runs");

    const run = await runsCollection.findOne({ _id: new ObjectId(runId) });
    if (!run || (run.status !== "scraping" && run.status !== "applying")) {
      return NextResponse.json({ error: "Run is not currently active" }, { status: 400 });
    }

    if (run.status === "applying") {
      await runsCollection.updateOne(
        { _id: run._id },
        { $set: { status: "failed", finishedAt: new Date(), failReason: "Stopped manually while stuck applying" } }
      );
      return NextResponse.json({ success: true });
    }

    await runsCollection.updateOne({ _id: run._id }, { $set: { status: "stopped", stoppedAt: new Date() } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("GeM bid sync stop error:", error);
    return NextResponse.json({ error: error.message || "Failed to stop sync" }, { status: 500 });
  }
}
