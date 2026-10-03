import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

// CORS-open — the extension's background worker polls GET and calls the
// sibling upload/finish routes directly, same convention as every other
// extension-facing route (see sync/apply/route.ts).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// POST { bidId } — queues a bid's real Bid Document + buyer-added ATC link
// (if any) to be fetched from GeM and cached in R2, for the image-based ATC
// pipeline (see lib/documentMaker/pdfEngine.ts) and the ZIP bundle. GeM
// blocks non-browser requests (see /api/gem-bids/cities's note), so this
// can't be fetched from the OMS server itself — the extension's background
// worker does it instead, the same reason Start Sync exists at all.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { bidId } = body;
    if (!bidId || !ObjectId.isValid(bidId)) {
      return NextResponse.json({ error: "Valid bidId is required" }, { status: 400, headers: corsHeaders });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const bidsCollection = db.collection("gem_bids");

    const now = new Date();
    const result = await bidsCollection.updateOne(
      { _id: new ObjectId(bidId) },
      { $set: { docFetch: { status: "pending", requestedAt: now, finishedAt: null, error: null } } }
    );
    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "Bid not found" }, { status: 404, headers: corsHeaders });
    }

    return NextResponse.json({ success: true }, { headers: corsHeaders });
  } catch (error: any) {
    console.error("GeM bid fetch-documents POST error:", error);
    return NextResponse.json({ error: error.message || "Failed to queue fetch" }, { status: 500, headers: corsHeaders });
  }
}

// GET — atomically claims the oldest pending fetch request (flips it to
// "fetching" in the same findOneAndUpdate, so the extension's ~1/min poll
// never double-claims one it's already working on) and returns the two
// source URLs it needs. Polled by background.js's existing Start-Sync alarm
// rather than a dedicated one — one GeM-document job at a time is plenty,
// no need for a second alarm just for this.
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const bidsCollection = db.collection("gem_bids");

    const result = await bidsCollection.findOneAndUpdate(
      { "docFetch.status": "pending" },
      { $set: { "docFetch.status": "fetching" } },
      { sort: { "docFetch.requestedAt": 1 }, returnDocument: "after" }
    );
    // Driver-version-shape defensive, same as /api/orders's counter
    // increment — findOneAndUpdate returns the document directly on some
    // mongodb driver versions and {value: doc} on others.
    const bid = (result as any)?.value ?? result;
    if (!bid) return NextResponse.json({ bid: null }, { headers: corsHeaders });

    return NextResponse.json(
      {
        bid: {
          _id: bid._id.toString(),
          bidNo: bid.bidNo,
          bidLink: bid.bidLink || "",
          buyerAddedBidSpecificAtcUrl: bid.buyerAddedBidSpecificAtcUrl || "",
        },
      },
      { headers: corsHeaders }
    );
  } catch (error: any) {
    console.error("GeM bid fetch-documents GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to claim fetch request" }, { status: 500, headers: corsHeaders });
  }
}
