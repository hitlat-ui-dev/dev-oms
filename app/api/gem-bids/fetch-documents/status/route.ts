import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

// GET ?bidId= — polled by Document Maker's "Fetch Bid Documents" button
// while a request is pending/fetching, to know when to enable the
// image-based ATC + ZIP bundle generation. Deliberately not the full bid
// document (that's /api/gem-bids?light=1 for the picker) - just the bit
// this one button cares about.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const bidId = searchParams.get("bidId") || "";
    if (!bidId || !ObjectId.isValid(bidId)) {
      return NextResponse.json({ error: "Valid bidId is required" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const bid = await db.collection("gem_bids").findOne(
      { _id: new ObjectId(bidId) },
      { projection: { docFetch: 1, bidSpecificAtc: 1, bidLinkDoc: 1 } }
    );
    if (!bid) {
      return NextResponse.json({ error: "Bid not found" }, { status: 404 });
    }

    return NextResponse.json({
      docFetch: bid.docFetch || { status: "idle" },
      hasBidDocument: !!bid.bidLinkDoc?.fileKey,
      hasAtcDocument: !!bid.bidSpecificAtc?.fileKey,
    });
  } catch (error: any) {
    console.error("GeM bid fetch-documents status error:", error);
    return NextResponse.json({ error: error.message || "Failed to load fetch status" }, { status: 500 });
  }
}
