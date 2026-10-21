import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";
import { normalizeItemKey } from "@/lib/documentMaker/boqEngine";

const DB_NAME = "dev_oms_db";

// POST { bidId, items: [{ itemNumber, itemTitle, rate, quantity?, baseRate?, marginPercent? }] } —
// saves the user's filled rates against this bid (boqRates, restored next
// time this bid's BOQ is opened - see ../route.ts) and upserts each into
// the shared rate directory (gem_bid_item_rate_history), keyed by the
// item's normalized title, so the next bid with a matching item title gets
// this as its suggestion (the directory only ever stores the final rate,
// not the base/margin breakdown - a suggestion is "what it sold for",
// someone else's base cost isn't necessarily relevant to a different bid).
// Only items with a non-blank rate are saved to the directory - a
// cleared/blank rate updates this bid's own record but doesn't overwrite a
// real historical rate with nothing. quantity, baseRate and marginPercent
// are stashed alongside the rate (not just itemNumber/itemTitle/rate) so
// reopening this bid's BOQ restores the full base-rate/margin breakdown,
// and a per-bid final total (quantity × rate) can be read straight off the
// bid doc later - see /api/gem-bids/final-rates - without re-fetching and
// re-parsing the original BOQ file just to get it back.
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
      baseRate: String(it.baseRate || "").trim(),
      marginPercent: String(it.marginPercent || "").trim(),
      // Only ever meaningful for a Regular Bid (see ../route.ts) - a BOQ
      // bid's unit always comes fresh from the re-parsed file on reload, so
      // this is unused (but harmless to store) for that case. A Regular
      // Bid has no file to re-derive it from, so it has to round-trip
      // through here like every other manually-typed field.
      unit: String(it.unit || "").trim(),
    }));

    await db.collection("gem_bids").updateOne({ _id: new ObjectId(bidId) }, { $set: { boqRates, boqRatesUpdatedAt: now } });

    const ratedItems = boqRates.filter((it: any) => it.rate && it.itemTitle);
    const historyOps = ratedItems.map((it: any) => ({
      updateOne: {
        filter: { itemKey: normalizeItemKey(it.itemTitle) },
        update: { $set: { itemKey: normalizeItemKey(it.itemTitle), itemTitle: it.itemTitle, rate: it.rate, bidNo: bid.bidNo, updatedAt: now } },
        upsert: true,
      },
    }));
    if (historyOps.length > 0) {
      await db.collection("gem_bid_item_rate_history").bulkWrite(historyOps, { ordered: false });
    }

    // Append-only log (unlike gem_bid_item_rate_history above, which only
    // ever keeps the latest rate per item - this keeps every one, for the
    // Central Item Rates page's trend view). Skips an item whose most
    // recent logged entry for THIS bid already has the same rate, so
    // re-saving unchanged values on every edit doesn't spam the log with
    // identical rows - only a genuine change (or a first save) adds one.
    if (ratedItems.length > 0) {
      const logCollection = db.collection("gem_bid_item_rate_log");
      const itemKeys = ratedItems.map((it: any) => normalizeItemKey(it.itemTitle));
      const lastLogged = await logCollection
        .find({ bidNo: bid.bidNo, itemKey: { $in: itemKeys } })
        .sort({ savedAt: -1 })
        .toArray();
      const lastRateByKey = new Map<string, string>();
      for (const l of lastLogged) if (!lastRateByKey.has(l.itemKey)) lastRateByKey.set(l.itemKey, l.rate);

      const logDocs = ratedItems
        .filter((it: any) => lastRateByKey.get(normalizeItemKey(it.itemTitle)) !== it.rate)
        .map((it: any) => ({
          itemKey: normalizeItemKey(it.itemTitle),
          itemTitle: it.itemTitle,
          rate: it.rate,
          baseRate: it.baseRate || "",
          marginPercent: it.marginPercent || "",
          bidNo: bid.bidNo,
          savedAt: now,
        }));
      if (logDocs.length > 0) {
        await logCollection.insertMany(logDocs);
      }
    }

    return NextResponse.json({ success: true, savedCount: boqRates.length });
  } catch (error: any) {
    console.error("GeM bid BOQ save error:", error);
    return NextResponse.json({ error: error.message || "Failed to save BOQ rates" }, { status: 500 });
  }
}
