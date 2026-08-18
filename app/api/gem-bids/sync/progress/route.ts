import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

const DB_NAME = "dev_oms_db";

// CORS-open like the import route — in Phase 2 this is posted to directly by
// the extension's background worker (chrome-extension:// origin) while a scrape
// is running, same convention already used by every other extension-facing route.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// POST: update a run's live progress. body: { runId, percent, phase? }
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { runId, percent, phase } = body;
    if (!runId || !ObjectId.isValid(runId) || typeof percent !== "number") {
      return NextResponse.json({ error: "runId and numeric percent are required" }, { status: 400, headers: corsHeaders });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const runsCollection = db.collection("gem_bid_sync_runs");

    const run = await runsCollection.findOne({ _id: new ObjectId(runId) });
    // A stopped/discarded run ignores further progress pings — the scraper
    // hasn't necessarily noticed the stop yet, but the OMS side should not
    // resurrect a run the user already cancelled.
    if (!run || run.status !== "scraping") {
      return NextResponse.json({ success: false, ignored: true }, { headers: corsHeaders });
    }

    await runsCollection.updateOne(
      { _id: run._id },
      { $set: { progressPercent: Math.max(0, Math.min(100, percent)), phase: phase || run.phase } }
    );

    return NextResponse.json({ success: true }, { headers: corsHeaders });
  } catch (error: any) {
    console.error("GeM bid sync progress error:", error);
    return NextResponse.json({ error: error.message || "Failed to update progress" }, { status: 500, headers: corsHeaders });
  }
}
