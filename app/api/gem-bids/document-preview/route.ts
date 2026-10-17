import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";
import { getSignedDownloadUrl } from "@/lib/cloudflareR2";

const DB_NAME = "dev_oms_db";

const KIND_FIELD: Record<string, string> = {
  atc: "bidSpecificAtc",
  bidLink: "bidLinkDoc",
  boq: "boqDetailDoc",
  spec: "specificationDoc",
};

// GET ?bidId=&kind=atc|bidLink|boq|spec — a short-lived signed R2 URL for
// one of a bid's already-fetched/uploaded source documents (see
// fetch-documents/upload/route.ts, the only writer of these fields), for
// GemBidTable's "BOQ Rates"/"BOQ Specifications" preview links to open
// directly in a new tab. No downloadFileName set - opening a PDF/CSV
// inline is the point here, not saving it.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const bidId = searchParams.get("bidId") || "";
    const kind = searchParams.get("kind") || "";
    if (!bidId || !ObjectId.isValid(bidId)) {
      return NextResponse.json({ error: "Valid bidId is required" }, { status: 400 });
    }
    if (!KIND_FIELD[kind]) {
      return NextResponse.json({ error: "kind must be atc, bidLink, boq, or spec" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const bid = await db.collection("gem_bids").findOne({ _id: new ObjectId(bidId) });
    if (!bid) {
      return NextResponse.json({ error: "Bid not found" }, { status: 404 });
    }
    const fileKey = bid[KIND_FIELD[kind]]?.fileKey;
    if (!fileKey) {
      return NextResponse.json({ error: "No document of this kind fetched for this bid yet" }, { status: 404 });
    }

    const url = await getSignedDownloadUrl(fileKey, 3600);
    return NextResponse.json({ url });
  } catch (error: any) {
    console.error("GeM bid document-preview error:", error);
    return NextResponse.json({ error: error.message || "Failed to build preview URL" }, { status: 500 });
  }
}
