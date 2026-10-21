import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { runAutoDocLinksJobIfDue } from "@/lib/gemBids/autoDocLinksJob";

const DB_NAME = "dev_oms_db";

// Each bid this job processes costs an R2 fetch, a full multi-page PDF
// parse (pdfjs-dist + @napi-rs/canvas), up to two external HTTP fetches,
// and up to two R2 uploads - easily several seconds each. Without this,
// the route fell back to Vercel's default function timeout (as little as
// 10s), which is nowhere near enough for even one bid's worth of work -
// confirmed live: every one of 141 checked bids came back
// autoDocLinksFound: false, including ones later proven (by re-running the
// exact same extraction locally, successfully) to have real links in
// their Bid Document. The timeout was killing the request before it ever
// got there, and the job's own error handling (see autoDocLinksJob.ts) was
// recording that as "checked, nothing found" - indistinguishable from a
// bid that genuinely has no such table.
export const maxDuration = 60;

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
