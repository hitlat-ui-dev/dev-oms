import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";
import { deleteFileFromR2 } from "@/lib/cloudflareR2";

const DB_NAME = "dev_oms_db";

const KIND_FIELD: Record<string, string> = {
  atc: "bidSpecificAtc",
  bidLink: "bidLinkDoc",
  boq: "boqDetailDoc",
  spec: "specificationDoc",
};

// POST { bidId, kind: "atc" | "bidLink" | "boq" | "spec" } — clears a
// wrongly-fetched/uploaded document (manual or auto-fetched from the Bid
// Document's own embedded links - see autoDocLinksJob.ts) back to "not
// fetched", for the Bid Rate page's Remove button next to Replace. Doesn't
// touch autoDocLinksCheckedAt, so a removed boq/spec document is never
// silently re-fetched by that job on its own - only Upload/Replace (a
// deliberate action) puts one back.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { bidId, kind } = body;
    if (!bidId || !ObjectId.isValid(bidId)) {
      return NextResponse.json({ error: "Valid bidId is required" }, { status: 400 });
    }
    if (!KIND_FIELD[kind]) {
      return NextResponse.json({ error: "kind must be atc, bidLink, boq, or spec" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const bidsCollection = db.collection("gem_bids");

    const bid = await bidsCollection.findOne({ _id: new ObjectId(bidId) });
    if (!bid) {
      return NextResponse.json({ error: "Bid not found" }, { status: 404 });
    }
    const fileKey = bid[KIND_FIELD[kind]]?.fileKey;
    if (fileKey) {
      await deleteFileFromR2(fileKey).catch((err) => console.error("Failed to delete R2 object (continuing anyway):", err));
    }

    await bidsCollection.updateOne({ _id: new ObjectId(bidId) }, { $unset: { [KIND_FIELD[kind]]: "" } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("GeM bid fetch-documents remove error:", error);
    return NextResponse.json({ error: error.message || "Failed to remove document" }, { status: 500 });
  }
}
