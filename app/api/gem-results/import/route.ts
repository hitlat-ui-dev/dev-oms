import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { normalizeItemKey } from "@/lib/documentMaker/boqEngine";

const DB_NAME = "dev_oms_db";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// POST — direct JSON import from the "GeM Bid Result Export" browser
// extension's "5) Approve → OMS me bhejo" button (content.js, $("ge-send")),
// the same real-GeM-result data the older version of that extension used to
// require exporting to an Excel file and uploading by hand via
// /api/gem-bids/market-rates/import (still there, unchanged, for whoever's
// still on that flow or re-uploading an old export). Both write into the
// same gem_bid_item_market_rate_history collection so the Market L1
// suggestion in boq/route.ts and the hover table in GemBidTable.tsx/
// document-maker read from one place regardless of which path a given bid's
// data came in through.
//
// body: { bidNo, evaluation, rows: [{ item, qty, ourRate, marketRate,
//   marketParty, diffPct, l1Rate, l1Party, l2Rate, l2Party, isOurL1,
//   headroomPct, source }], ... }
// l1Rate/l1Party is the extension's own resolved "real L1" (itself when it
// won, the competitor otherwise - see content.js's fixL1) and is preferred
// over the older marketRate/marketParty fields when present, so a bid
// re-sent through this newer flow always reflects that distinction even
// though both still arrive on every row for backward compatibility.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const bidNo = String(body.bidNo || "").trim();
    const evaluationType = String(body.evaluation || "").trim();
    const rows = Array.isArray(body.rows) ? body.rows : [];

    const parsed = rows
      .map((r: any) => {
        const itemTitle = String(r.item || "").trim();
        const l1Rate = Number(r.l1Rate ?? r.marketRate);
        const l1Party = String(r.l1Party ?? r.marketParty ?? "").trim();
        const diffPercent = Number(r.diffPct);
        const l2RateNum = Number(r.l2Rate);
        return {
          itemKey: normalizeItemKey(itemTitle),
          itemTitle,
          l1Rate,
          l1Party,
          diffPercent: Number.isFinite(diffPercent) ? diffPercent : null,
          l2Rate: Number.isFinite(l2RateNum) ? l2RateNum : null,
          l2Party: String(r.l2Party || "").trim(),
          isOurL1: !!r.isOurL1,
          headroomPct: Number.isFinite(Number(r.headroomPct)) ? Number(r.headroomPct) : null,
          source: r.source === "ESTIMATED" ? "ESTIMATED" : "REAL",
        };
      })
      .filter((r: any) => r.itemTitle && Number.isFinite(r.l1Rate) && r.l1Rate > 0);

    if (parsed.length === 0) {
      return NextResponse.json({ error: "No usable rows (need item + a real L1/market rate)" }, { status: 422, headers: corsHeaders });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const collection = db.collection("gem_bid_item_market_rate_history");

    if (bidNo) await collection.deleteMany({ bidNo });

    // Same denormalized "Place" resolution as the Excel-upload path (see
    // market-rates/import/route.ts) - looked up once here against this bid
    // if it's still in the OMS, rather than joined on every Fill Rates load.
    const place = bidNo ? (await db.collection("gem_bids").findOne({ bidNo }, { projection: { address: 1 } }))?.address || "" : "";

    const now = new Date();
    await collection.insertMany(
      parsed.map((r: any) => ({
        ...r,
        bidNo: bidNo || null,
        evaluationType: evaluationType || "",
        place,
        importedAt: now,
      }))
    );

    return NextResponse.json({ success: true, bidNo: bidNo || null, importedCount: parsed.length }, { headers: corsHeaders });
  } catch (error: any) {
    console.error("GeM results import error:", error);
    return NextResponse.json({ error: error.message || "Import failed" }, { status: 500, headers: corsHeaders });
  }
}
