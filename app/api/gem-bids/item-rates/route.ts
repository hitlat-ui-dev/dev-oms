import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

const DB_NAME = "dev_oms_db";
const DEFAULT_LIMIT = 300;

// GET ?search=&source=ours|market&limit= — the "Central Bid Item Rates"
// page's one data source, merging two collections that were deliberately
// kept separate for their own original purposes (gem_bid_item_rate_log,
// append-only since the Bid Rate save of this same turn - see
// boq/save/route.ts; and gem_bid_item_market_rate_history, from imported
// GeM results - see marketRateEngine.ts) into one combined, searchable,
// date-sorted list rather than duplicating either into a third collection.
// search matches itemTitle (case-insensitive substring); source narrows to
// just one side when given, otherwise both are merged.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const search = (searchParams.get("search") || "").trim();
    const source = searchParams.get("source") || "";
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "", 10) || DEFAULT_LIMIT, 1), 1000);

    const client = await clientPromise;
    const db = client.db(DB_NAME);

    const textFilter = search ? { itemTitle: { $regex: search, $options: "i" } } : {};

    const [ours, market] = await Promise.all([
      source === "market"
        ? []
        : db
            .collection("gem_bid_item_rate_log")
            .find(textFilter)
            .sort({ savedAt: -1 })
            .limit(limit)
            .toArray(),
      source === "ours"
        ? []
        : db
            .collection("gem_bid_item_market_rate_history")
            .find(textFilter)
            .sort({ importedAt: -1 })
            .limit(limit)
            .toArray(),
    ]);

    const rows = [
      ...ours.map((r: any) => ({
        source: "ours" as const,
        itemTitle: r.itemTitle,
        rate: r.rate,
        party: "",
        bidNo: r.bidNo || "",
        date: r.savedAt || null,
        place: "",
        evaluationType: "",
      })),
      ...market.map((r: any) => ({
        source: "market" as const,
        itemTitle: r.itemTitle,
        rate: String(r.l1Rate),
        party: r.l1Party || "",
        bidNo: r.bidNo || "",
        date: r.importedAt || null,
        place: r.place || "",
        evaluationType: r.evaluationType || "",
      })),
    ].sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

    return NextResponse.json({ rows: rows.slice(0, limit) });
  } catch (error: any) {
    console.error("GeM bid item-rates error:", error);
    return NextResponse.json({ error: error.message || "Failed to load item rates" }, { status: 500 });
  }
}
