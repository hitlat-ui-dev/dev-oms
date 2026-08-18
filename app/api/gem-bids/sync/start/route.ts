import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

// POST: start a new sync run, or resume/replace a previously stopped one.
// body: { startedBy, resolution?: "keep" | "discard" }
// If a run was left "stopped" (Stop was clicked mid-scrape) and no resolution
// is given, this responds 409 asking the caller to choose "keep" (resume that
// same run) or "discard" (mark it discarded and start clean) — the UI shows
// that as the Keep/Discard prompt before actually starting.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { startedBy, resolution } = body;

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const runsCollection = db.collection("gem_bid_sync_runs");

    const previousStopped = await runsCollection.findOne({ status: "stopped" }, { sort: { startedAt: -1 } });

    if (previousStopped && !resolution) {
      return NextResponse.json(
        { needsResolution: true, previousRun: previousStopped },
        { status: 409 }
      );
    }

    if (previousStopped && resolution === "discard") {
      await runsCollection.updateOne({ _id: previousStopped._id }, { $set: { status: "discarded" } });
    }

    if (previousStopped && resolution === "keep") {
      const now = new Date();
      await runsCollection.updateOne(
        { _id: previousStopped._id },
        { $set: { status: "scraping", progressPercent: previousStopped.progressPercent || 0, resumedAt: now } }
      );
      return NextResponse.json({ runId: previousStopped._id.toString(), status: "scraping", resumed: true });
    }

    const now = new Date();
    const result = await runsCollection.insertOne({
      status: "scraping",
      progressPercent: 0,
      phase: "starting",
      startedAt: now,
      finishedAt: null,
      startedBy: startedBy || "",
    });

    return NextResponse.json({ runId: result.insertedId.toString(), status: "scraping", resumed: false });
  } catch (error: any) {
    console.error("GeM bid sync start error:", error);
    return NextResponse.json({ error: error.message || "Failed to start sync" }, { status: 500 });
  }
}
