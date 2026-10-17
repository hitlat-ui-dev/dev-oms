import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { parseMarketRateXlsx, parseMarketRateBidNo } from "@/lib/documentMaker/marketRateEngine";

const DB_NAME = "dev_oms_db";

// POST multipart/form-data { file } — imports a Bid Results Excel from the
// user's own "gem-result-extension" (see marketRateEngine.ts) into
// gem_bid_item_market_rate_history, one document per item row. Re-
// importing the same bid's file replaces that bid's own rows (deleteMany
// on bidNo first) rather than appending duplicates - the file for a given
// bid can be re-exported as its evaluation progresses (more schedules
// resolved from "Evaluation in Progress" to a real L1 Rate), and each
// later import should reflect that, not pile on top of a stale earlier
// snapshot of the same bid.
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const bidNo = parseMarketRateBidNo(buffer);
    const rows = parseMarketRateXlsx(buffer);
    if (rows.length === 0) {
      return NextResponse.json({ error: "No usable rows found (need Item Name + a real L1 Rate on the Rates sheet)" }, { status: 422 });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const collection = db.collection("gem_bid_item_market_rate_history");

    if (bidNo) await collection.deleteMany({ bidNo });

    const now = new Date();
    await collection.insertMany(
      rows.map((r) => ({
        itemKey: r.itemKey,
        itemTitle: r.itemTitle,
        l1Rate: r.l1Rate,
        l1Party: r.l1Party,
        diffPercent: Number.isFinite(r.diffPercent) ? r.diffPercent : null,
        bidNo: bidNo || null,
        importedAt: now,
      }))
    );

    return NextResponse.json({ success: true, bidNo: bidNo || null, importedCount: rows.length });
  } catch (error: any) {
    console.error("GeM bid market-rates import error:", error);
    return NextResponse.json({ error: error.message || "Import failed" }, { status: 500 });
  }
}
