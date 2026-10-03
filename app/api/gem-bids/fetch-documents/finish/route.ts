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

// POST { bidId, errors?: { atc?: string, bidLink?: string } } — called by
// the extension's background worker once it's attempted both source PDFs
// (see ../upload/route.ts) for a claimed job, whether or not either one
// actually succeeded. The buyer-added ATC link is blank on many bids (GeM's
// ATC download is often a JS action, not a real link in the PDF — see
// content.js's ATC_LABEL comment), so an atc error there is routine, not a
// genuine failure; status still lands on "done" as long as the Bid Link
// document itself came through, since that alone is enough for the ZIP
// bundle and the image-based ATC pipeline's text-cover fallback.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { bidId, errors } = body;
    if (!bidId || !ObjectId.isValid(bidId)) {
      return NextResponse.json({ error: "Valid bidId is required" }, { status: 400, headers: corsHeaders });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const bidsCollection = db.collection("gem_bids");

    const bid = await bidsCollection.findOne({ _id: new ObjectId(bidId) });
    if (!bid) {
      return NextResponse.json({ error: "Bid not found" }, { status: 404, headers: corsHeaders });
    }

    const bidLinkFailed = !bid.bidLinkDoc?.fileKey;
    const status = bidLinkFailed ? "failed" : "done";
    const errorMsg = [errors?.bidLink && `Bid document: ${errors.bidLink}`, errors?.atc && `ATC link: ${errors.atc}`]
      .filter(Boolean)
      .join(" | ");

    await bidsCollection.updateOne(
      { _id: new ObjectId(bidId) },
      { $set: { docFetch: { status, requestedAt: bid.docFetch?.requestedAt || new Date(), finishedAt: new Date(), error: errorMsg || null } } }
    );

    return NextResponse.json({ success: true, status }, { headers: corsHeaders });
  } catch (error: any) {
    console.error("GeM bid fetch-documents finish error:", error);
    return NextResponse.json({ error: error.message || "Failed to finish fetch" }, { status: 500, headers: corsHeaders });
  }
}
