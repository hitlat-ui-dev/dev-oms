import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// POST { bidId, status?, error? } — reports one bid's result from a claimed
// GET /api/gem-bids/refresh-status batch. status (the literal text read off
// GeM) is written into bidStatus, same field the Bid Status column itself
// edits - a refresh and a manual edit are the same field either way, this
// is just an automated writer for it. error (no status found / fetch
// failed) still clears the "fetching" flag so the bid isn't stuck pending
// forever, but leaves bidStatus untouched.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { bidId, status, error } = body;
    if (!bidId || !ObjectId.isValid(bidId)) {
      return NextResponse.json({ error: "Valid bidId is required" }, { status: 400, headers: corsHeaders });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const now = new Date();

    const set: Record<string, any> = {
      statusRefresh: { status: error ? "failed" : "done", finishedAt: now, error: error || null },
    };
    if (typeof status === "string" && status.trim()) {
      set.bidStatus = status.trim();
      set.lastModifiedBy = "GeM Bid Exporter (auto-refresh)";
      set.lastModifiedAt = now;
    }

    await db.collection("gem_bids").updateOne({ _id: new ObjectId(bidId) }, { $set: set });

    return NextResponse.json({ success: true }, { headers: corsHeaders });
  } catch (error: any) {
    console.error("GeM bid refresh-status complete error:", error);
    return NextResponse.json({ error: error.message || "Failed to record status" }, { status: 500, headers: corsHeaders });
  }
}
