import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";

// GET — every bid that has at least one saved BOQ rate (see
// /api/gem-bids/boq/save), for the Final Rates page: a read-only summary
// of what's actually been quoted so far, across every bid, instead of
// having to open each one individually in Bid Rate to see its numbers.
// boqRates carries quantity alongside rate (added once this page needed
// it - see boq/save/route.ts's own comment), so the Grand Total per bid
// is computed here straight off the bid doc, no re-fetch of the original
// BOQ file needed. A bid whose rates were saved before quantity started
// being stored will show 0 for those older items until its rates are
// resaved from Bid Rate.
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const bids = await db
      .collection("gem_bids")
      .find(
        { "boqRates.0": { $exists: true }, deletedAt: { $exists: false } },
        {
          projection: {
            bidNo: 1,
            items: 1,
            address: 1,
            departmentNameAndAddress: 1,
            bidLink: 1,
            buyerAddedBidSpecificAtcUrl: 1,
            bidToRaEnabled: 1,
            raQualificationRule: 1,
            typeOfBid: 1,
            evaluationMethod: 1,
            emdAmount: 1,
            selectedPartyIds: 1,
            selectedPartyId: 1,
            boqRates: 1,
            boqRatesUpdatedAt: 1,
          },
        }
      )
      .sort({ boqRatesUpdatedAt: -1 })
      .toArray();

    const result = bids.map((b: any) => {
      const itemsRated = (b.boqRates || []).filter((r: any) => String(r.rate || "").trim()).length;
      const finalTotal = (b.boqRates || []).reduce((sum: number, r: any) => {
        const qty = parseFloat(r.quantity) || 0;
        const rate = parseFloat(r.rate) || 0;
        return sum + qty * rate;
      }, 0);
      return { ...b, itemsRated, finalTotal };
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("GeM bid final-rates error:", error);
    return NextResponse.json({ error: error.message || "Failed to load final rates" }, { status: 500 });
  }
}
