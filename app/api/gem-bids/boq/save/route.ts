import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";
import { normalizeItemKey } from "@/lib/documentMaker/boqEngine";

const DB_NAME = "dev_oms_db";

// POST { bidId, items: [{ itemNumber, itemTitle, rate, quantity? }] } —
// saves the user's filled rates against this bid (boqRates, restored next
// time this bid's BOQ is opened - see ../route.ts) and upserts each into
// the shared rate directory (gem_bid_item_rate_history), keyed by the
// item's normalized title, so the next bid with a matching item title gets
// this as its suggestion. Only items with a non-blank rate are saved to the
// directory - a cleared/blank rate updates this bid's own record but
// doesn't overwrite a real historical rate with nothing. quantity is
// stashed alongside the rate (not just itemNumber/itemTitle/rate) so a
// per-bid final total (quantity × rate, every item) can be read straight
// off the bid doc later - see /api/gem-bids/final-rates - without having
// to re-fetch and re-parse the original BOQ file just to get it back.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { bidId, items } = body;
    if (!bidId || !ObjectId.isValid(bidId)) {
      return NextResponse.json({ error: "Valid bidId is required" }, { status: 400 });
    }
    if (!Array.isArray(items)) {
      return NextResponse.json({ error: "items must be an array" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const bid = await db.collection("gem_bids").findOne({ _id: new ObjectId(bidId) });
    if (!bid) {
      return NextResponse.json({ error: "Bid not found" }, { status: 404 });
    }

    const now = new Date();
    const boqRates = items.map((it: any) => ({
      itemNumber: String(it.itemNumber || ""),
      itemTitle: String(it.itemTitle || ""),
      rate: String(it.rate || "").trim(),
      quantity: String(it.quantity || "").trim(),
    }));

    await db.collection("gem_bids").updateOne({ _id: new ObjectId(bidId) }, { $set: { boqRates, boqRatesUpdatedAt: now } });

    const historyOps = boqRates
      .filter((it: any) => it.rate && it.itemTitle)
      .map((it: any) => ({
        updateOne: {
          filter: { itemKey: normalizeItemKey(it.itemTitle) },
          update: { $set: { itemKey: normalizeItemKey(it.itemTitle), itemTitle: it.itemTitle, rate: it.rate, bidNo: bid.bidNo, updatedAt: now } },
          upsert: true,
        },
      }));
    if (historyOps.length > 0) {
      await db.collection("gem_bid_item_rate_history").bulkWrite(historyOps, { ordered: false });
    }

    return NextResponse.json({ success: true, savedCount: boqRates.length });
  } catch (error: any) {
    console.error("GeM bid BOQ save error:", error);
    return NextResponse.json({ error: error.message || "Failed to save BOQ rates" }, { status: 500 });
  }
}
