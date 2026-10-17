import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { runAutoDocLinksJobIfDue } from "@/lib/gemBids/autoDocLinksJob";

const DB_NAME = "dev_oms_db";

// POST — fired from app/layout.tsx on every site visit (fire-and-forget,
// same pattern as /api/gem-bids/expire-and-purge). The job itself decides
// whether it's actually due (self-throttled) - see autoDocLinksJob.ts.
export async function POST() {
  try {
    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const result = await runAutoDocLinksJobIfDue(db);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("GeM bid auto-doc-links error:", error);
    return NextResponse.json({ error: error.message || "Auto-doc-links job failed" }, { status: 500 });
  }
}
