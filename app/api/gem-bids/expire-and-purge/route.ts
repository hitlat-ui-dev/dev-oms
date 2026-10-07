import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { runExpireBidsJobIfDue } from "@/lib/gemBids/expireBidsJob";

const DB_NAME = "dev_oms_db";

// POST — fired from app/layout.tsx on every site visit (fire-and-forget,
// same pattern as /api/backup/auto, /api/courier/auto, and /api/gem-bids/
// purge-deleted). The job itself decides whether it's actually due (once
// per evening) - see lib/gemBids/expireBidsJob.ts.
export async function POST() {
  try {
    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const result = await runExpireBidsJobIfDue(db);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("GeM bid expire-and-purge error:", error);
    return NextResponse.json({ error: error.message || "Expire-and-purge job failed" }, { status: 500 });
  }
}
