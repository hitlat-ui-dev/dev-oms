import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// GET ?batchId= — live progress for one Bid Status Refresh run (see
// ../route.ts's POST, which stamps every bid it queues with this same
// batchId). GemBidTable polls this while a refresh is active to show
// "X/Y done" instead of the old fire-and-forget "queued" alert with no
// way to tell whether it was still running, stuck, or finished.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const batchId = searchParams.get("batchId") || "";
    if (!batchId) {
      return NextResponse.json({ error: "batchId is required" }, { status: 400, headers: corsHeaders });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const bidsCollection = db.collection("gem_bids");

    const counts = await bidsCollection
      .aggregate([
        { $match: { "statusRefresh.batchId": batchId } },
        { $group: { _id: "$statusRefresh.status", count: { $sum: 1 } } },
      ])
      .toArray();

    const byStatus: Record<string, number> = { pending: 0, fetching: 0, done: 0, failed: 0 };
    let total = 0;
    for (const c of counts) {
      byStatus[c._id as string] = c.count;
      total += c.count;
    }

    return NextResponse.json(
      {
        total,
        done: byStatus.done,
        failed: byStatus.failed,
        pending: byStatus.pending,
        fetching: byStatus.fetching,
        complete: total > 0 && byStatus.pending === 0 && byStatus.fetching === 0,
      },
      { headers: corsHeaders }
    );
  } catch (error: any) {
    console.error("GeM bid refresh-status progress error:", error);
    return NextResponse.json({ error: error.message || "Failed to load progress" }, { status: 500, headers: corsHeaders });
  }
}
