import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { applySubmittedStatusUpdates } from "@/lib/gemBids/applySubmittedStatus";

const DB_NAME = "dev_oms_db";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// POST: set submittedStatus for one or more Submitted Bids by Bid No. Used both
// by the manual status dropdown in the UI (one bid at a time) and, in Phase 2,
// by the extension's per-sync portal status check (a batch of updates at once) —
// same endpoint either way, only a value in SUBMITTED_STATUSES is ever accepted.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const updates: { bidNo: string; status: string }[] = Array.isArray(body.updates) ? body.updates : [];
    if (updates.length === 0) {
      return NextResponse.json({ error: "updates are required" }, { status: 400, headers: corsHeaders });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const updatedCount = await applySubmittedStatusUpdates(db, updates);

    return NextResponse.json({ success: true, updatedCount }, { headers: corsHeaders });
  } catch (error: any) {
    console.error("GeM bid submitted-status error:", error);
    return NextResponse.json({ error: error.message || "Status update failed" }, { status: 500, headers: corsHeaders });
  }
}
