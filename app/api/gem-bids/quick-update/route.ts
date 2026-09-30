import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

// Fields this endpoint is allowed to touch - kept short and explicit rather
// than accepting an arbitrary key, since this bypasses the Edit Bid modal's
// EDITABLE_FIELD_KEYS/LOCKED_FIELD_KEYS gate entirely (these two aren't
// scraped bid data at all, just app-level workflow fields).
const ALLOWED_FIELDS = ["selectedPartyId", "bidStatus"];

// POST: set one workflow field on a bid and record who/when - backs the
// Party dropdown (Bids to Fill) and the Bid Status field (Submitted Bids)
// in GemBidTable.tsx. body: { bidNo, field, value, changedBy? }
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { bidNo, field, value, changedBy } = body;
    if (!bidNo || typeof bidNo !== "string") {
      return NextResponse.json({ error: "bidNo is required" }, { status: 400 });
    }
    if (!ALLOWED_FIELDS.includes(field)) {
      return NextResponse.json({ error: `field must be one of ${ALLOWED_FIELDS.join(", ")}` }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const bidsCollection = db.collection("gem_bids");

    const now = new Date();
    const result = await bidsCollection.updateOne(
      { bidNo },
      {
        $set: {
          [field]: typeof value === "string" ? value.trim() : value,
          lastModifiedBy: changedBy || "",
          lastModifiedAt: now,
          updatedAt: now,
        },
      }
    );
    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "Bid not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("GeM bid quick-update error:", error);
    return NextResponse.json({ error: error.message || "Update failed" }, { status: 500 });
  }
}
