import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { enqueueDocFetchForBids } from "@/lib/gemBids/autoDocLinksJob";

const DB_NAME = "dev_oms_db";

// POST { bidIds: string[] } — GemBidTable's "Fetch Documents" bulk action
// (Bids to Fill/Submitted Bids only). Queues each selected bid's Bid
// Document fetch (same docFetch mechanism Generate ATC already uses) -
// the extension's background worker picks these up within its own ~1 min
// poll; once fetched, autoDocLinksJob.ts's self-throttled site-visit check
// (see /api/gem-bids/auto-doc-links) reads it for embedded Specification/
// BOQ Detail Document links and fetches those directly, no extension
// round trip needed for that half.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { bidIds } = body;
    if (!Array.isArray(bidIds) || bidIds.length === 0) {
      return NextResponse.json({ error: "bidIds are required" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const result = await enqueueDocFetchForBids(db, bidIds);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("GeM bid fetch-documents bulk error:", error);
    return NextResponse.json({ error: error.message || "Failed to queue document fetch" }, { status: 500 });
  }
}
