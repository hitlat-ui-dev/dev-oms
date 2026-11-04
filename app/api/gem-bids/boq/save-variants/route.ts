import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

// POST { bidId, variantPartyPercents: { [companyId]: percent } } — saved
// every time Bid Rate's BOQ Rate Variants tool (re)generates its variants,
// so the Bid Summary page (see ../../bid-summary/route.ts) can show each
// assigned firm's own Final Rate - its L1 total bumped by its own variant's
// % - without re-deriving the whole variant engine there. A firm not
// present in this map (never assigned a variant, or assigned Variant 1 -
// always exactly L1, 0%) just falls back to the plain L1 total.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { bidId, variantPartyPercents } = body;
    if (!bidId || !ObjectId.isValid(bidId)) {
      return NextResponse.json({ error: "Valid bidId is required" }, { status: 400 });
    }
    if (!variantPartyPercents || typeof variantPartyPercents !== "object" || Array.isArray(variantPartyPercents)) {
      return NextResponse.json({ error: "variantPartyPercents must be an object" }, { status: 400 });
    }

    const clean: Record<string, number> = {};
    for (const [partyId, pct] of Object.entries(variantPartyPercents)) {
      if (!/^[a-zA-Z0-9_-]+$/.test(partyId)) continue;
      const n = Number(pct);
      if (Number.isFinite(n)) clean[partyId] = n;
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    await db.collection("gem_bids").updateOne({ _id: new ObjectId(bidId) }, { $set: { boqVariantPartyPercents: clean } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("GeM bid variant-percents save error:", error);
    return NextResponse.json({ error: error.message || "Failed to save variant percents" }, { status: 500 });
  }
}
