import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";
import { getFileFromR2 } from "@/lib/cloudflareR2";
import { parseBoqXlsx, normalizeItemKey } from "@/lib/documentMaker/boqEngine";

const DB_NAME = "dev_oms_db";

// GET ?bidId= — parses the bid's fetched BOQ Detail Document (see
// /api/gem-bids/fetch-documents) into its line items, merges in any rate
// already saved for THIS bid (reopening a bid you've part-filled before),
// and attaches a rate suggestion per item from gem_bid_item_rate_history -
// the directory of rates saved against other bids, keyed by a normalized
// item title (see boqEngine.ts's normalizeItemKey), updated every time
// /api/gem-bids/boq/save runs. A brand-new item with no history match
// simply gets no suggestion.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const bidId = searchParams.get("bidId") || "";
    if (!bidId || !ObjectId.isValid(bidId)) {
      return NextResponse.json({ error: "Valid bidId is required" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const bid = await db.collection("gem_bids").findOne({ _id: new ObjectId(bidId) });
    if (!bid) {
      return NextResponse.json({ error: "Bid not found" }, { status: 404 });
    }
    if (!bid.boqDetailDoc?.fileKey) {
      return NextResponse.json({ error: "No BOQ Detail Document fetched for this bid yet" }, { status: 400 });
    }

    const boqBytes = await getFileFromR2(bid.boqDetailDoc.fileKey);
    const parsedItems = parseBoqXlsx(boqBytes);
    if (parsedItems.length === 0) {
      return NextResponse.json({ error: "Couldn't find any rows in this BOQ file" }, { status: 422 });
    }

    const savedRates: Record<string, string> = {};
    for (const r of bid.boqRates || []) {
      if (r.itemNumber) savedRates[r.itemNumber] = r.rate;
    }

    const itemKeys = parsedItems.map((it) => normalizeItemKey(it.itemTitle || it.itemDescription));
    const historyDocs =
      itemKeys.length > 0
        ? await db.collection("gem_bid_item_rate_history").find({ itemKey: { $in: itemKeys } }).toArray()
        : [];
    const historyByKey = new Map(historyDocs.map((h: any) => [h.itemKey, h]));

    const items = parsedItems.map((it) => {
      const key = normalizeItemKey(it.itemTitle || it.itemDescription);
      const history = historyByKey.get(key);
      return {
        ...it,
        rate: savedRates[it.itemNumber] || "",
        suggestedRate: history?.rate || "",
        suggestedFromBidNo: history?.bidNo || "",
      };
    });

    return NextResponse.json({ items });
  } catch (error: any) {
    console.error("GeM bid BOQ parse error:", error);
    return NextResponse.json({ error: error.message || "Failed to parse BOQ" }, { status: 500 });
  }
}
