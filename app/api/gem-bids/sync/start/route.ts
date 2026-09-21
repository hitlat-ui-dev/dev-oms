import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

// POST: start a new sync run, or resume/replace a previously stopped one.
// body: { startedBy, resolution?: "keep" | "discard", filterState?, filterCities?: string[],
//         dateFrom?, dateTo?, filterExcludeKeywords?: string[] }
// If a run was left "stopped" (Stop was clicked mid-scrape) and no resolution
// is given, this responds 409 asking the caller to choose "keep" (resume that
// same run) or "discard" (mark it discarded and start clean) — the UI shows
// that as the Keep/Discard prompt before actually starting.
//
// filterState/filterCities/dateFrom/dateTo/filterExcludeKeywords are the
// Advance Search + item filters the user picked in the Start Sync modal (see
// GemBidsPage) — the extension's background worker reads them off this run
// (via GET /sync/status) to drive GeM's own Consignee State/City/Date fields
// and to filter scraped rows before scraping, instead of requiring the GeM
// tab to already be manually filtered and the extension popup's own filter
// fields to already be set.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { startedBy, resolution, filterState, filterCities, dateFrom, dateTo, filterExcludeKeywords } = body;

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
      filterState: (typeof filterState === "string" && filterState.trim()) || "Gujarat",
      filterCities: Array.isArray(filterCities)
        ? filterCities.filter((c) => typeof c === "string" && c.trim()).map((c) => c.trim())
        : [],
      dateFrom: (typeof dateFrom === "string" && dateFrom.trim()) || "",
      dateTo: (typeof dateTo === "string" && dateTo.trim()) || "",
      excludeKeywords: Array.isArray(filterExcludeKeywords)
        ? filterExcludeKeywords.filter((k) => typeof k === "string" && k.trim()).map((k) => k.trim())
        : [],
    });

    return NextResponse.json({ runId: result.insertedId.toString(), status: "scraping", resumed: false });
  } catch (error: any) {
    console.error("GeM bid sync start error:", error);
    return NextResponse.json({ error: error.message || "Failed to start sync" }, { status: 500 });
  }
}
