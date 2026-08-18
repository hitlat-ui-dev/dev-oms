import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { applyImport } from "@/lib/gemBids/applyImport";
import { applySubmittedStatusUpdates } from "@/lib/gemBids/applySubmittedStatus";

const DB_NAME = "dev_oms_db";

// CORS-open — the extension's background worker (Phase 2) calls this directly
// once a scrape finishes, same convention as every other extension-facing route.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// POST: the one atomic "apply everything from this completed run" step — live
// portal data must not change until a run is fully done (see the module plan),
// so this is the only place a Run's results actually touch gem_bids.
// body: { runId, rows, userName?, submittedStatusUpdates?: {bidNo,status}[] }
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { runId, rows, userName, submittedStatusUpdates } = body;
    if (!runId || !ObjectId.isValid(runId) || !Array.isArray(rows)) {
      return NextResponse.json({ error: "runId and rows are required" }, { status: 400, headers: corsHeaders });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const syncRunsCollection = db.collection("gem_bid_sync_runs");

    const run = await syncRunsCollection.findOne({ _id: new ObjectId(runId) });
    if (!run) {
      return NextResponse.json({ error: "Sync run not found" }, { status: 404, headers: corsHeaders });
    }
    if (run.status === "stopped" || run.status === "discarded") {
      // Guards against a race where Stop was clicked right as the scrape
      // finished — a stopped run's data is never applied, full stop.
      return NextResponse.json({ error: "This run was stopped and its data was not applied" }, { status: 409, headers: corsHeaders });
    }

    await syncRunsCollection.updateOne({ _id: run._id }, { $set: { status: "applying", progressPercent: 100 } });

    const importResult = rows.length > 0
      ? await applyImport(db, { rows, userName, source: "extension_direct" })
      : { newCount: 0, updatedCount: 0, oldCount: 0, excludedCount: 0, promotedCount: 0, expiredDeletedCount: 0, runId: "" };

    const statusUpdatedCount = await applySubmittedStatusUpdates(db, submittedStatusUpdates || []);

    await syncRunsCollection.updateOne(
      { _id: run._id },
      { $set: { status: "completed", finishedAt: new Date(), progressPercent: 100, importResult, statusUpdatedCount } }
    );

    return NextResponse.json({ success: true, ...importResult, statusUpdatedCount }, { headers: corsHeaders });
  } catch (error: any) {
    console.error("GeM bid sync apply error:", error);
    return NextResponse.json({ error: error.message || "Apply failed" }, { status: 500, headers: corsHeaders });
  }
}
