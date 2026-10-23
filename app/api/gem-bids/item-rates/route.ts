import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { tokenizeMatchText, scoreTokenSimilarity } from "@/lib/gemSync/catalogueMatch";

const DB_NAME = "dev_oms_db";
const DEFAULT_LIMIT = 300;

// GET ?search=&limit= — one row per distinct item (not one row per rate
// event, which is what this used to be - redesigned by request into a
// proper per-item management view), pulling together everything the OMS
// knows about that item from four places that each stay the source of
// truth for their own slice rather than being merged into one collection:
//   - gem_bid_item_rate_log (our own rate, appended every Bid Rate save -
//     see boq/save/route.ts) -> "ourRate", the most recent entry
//   - gem_bid_item_market_rate_history (imported GeM results - see
//     marketRateEngine.ts) -> "marketRate" (most recent) + up to 5 most
//     recent full samples for the frontend's hover table
//   - gem_bid_item_master (see ../item-master/route.ts) -> alternateNames,
//     preferredRate, remarks - the only three fields an item can have with
//     genuinely nowhere else to live
//   - pricelist_items/pricelist_tags (Purchase > Pricelist's own supplier
//     catalogue - a completely separate module) -> "pricelistRate",
//     matched by token similarity (same 0.5-score/>=1-overlap approach
//     already used for Received Purchase matching in boq/route.ts) since
//     a pricelist tag name and a GeM BOQ item title are two independently
//     typed strings with no shared key to begin with
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const search = (searchParams.get("search") || "").trim();
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "", 10) || DEFAULT_LIMIT, 1), 1000);

    const client = await clientPromise;
    const db = client.db(DB_NAME);

    const textFilter = search ? { itemTitle: { $regex: search, $options: "i" } } : {};

    const [ourLog, marketLog, masters] = await Promise.all([
      db.collection("gem_bid_item_rate_log").find(textFilter).sort({ savedAt: -1 }).toArray(),
      db.collection("gem_bid_item_market_rate_history").find(textFilter).sort({ importedAt: -1 }).toArray(),
      db.collection("gem_bid_item_master").find({}).toArray(),
    ]);

    // Grouped by itemKey - ourLog/marketLog are already sorted newest-first
    // above, so the first entry seen per key in each loop is automatically
    // the latest one.
    type Row = {
      itemKey: string;
      itemTitle: string;
      ourRate: string;
      ourBidNo: string;
      ourDate: string | null;
      marketRate: string;
      marketSampleCount: number;
      marketSamples: { rate: number; party: string; date: string | null; place: string; evaluationType: string; bidNo: string }[];
      alternateNames: string[];
      preferredRate: string;
      remarks: string;
    };
    const rows = new Map<string, Row>();
    const getRow = (itemKey: string, itemTitle: string): Row => {
      let r = rows.get(itemKey);
      if (!r) {
        r = {
          itemKey,
          itemTitle,
          ourRate: "",
          ourBidNo: "",
          ourDate: null,
          marketRate: "",
          marketSampleCount: 0,
          marketSamples: [],
          alternateNames: [],
          preferredRate: "",
          remarks: "",
        };
        rows.set(itemKey, r);
      }
      return r;
    };

    for (const d of ourLog) {
      const r = getRow(d.itemKey, d.itemTitle);
      if (!r.ourRate) {
        r.ourRate = d.rate;
        r.ourBidNo = d.bidNo || "";
        r.ourDate = d.savedAt || null;
      }
    }

    const marketByKey = new Map<string, any[]>();
    for (const d of marketLog) {
      const list = marketByKey.get(d.itemKey) || [];
      list.push(d);
      marketByKey.set(d.itemKey, list);
    }
    for (const [itemKey, samples] of marketByKey) {
      const r = getRow(itemKey, samples[0].itemTitle);
      r.marketRate = String(samples[0].l1Rate);
      r.marketSampleCount = samples.length;
      r.marketSamples = samples.slice(0, 5).map((s) => ({
        rate: s.l1Rate,
        party: s.l1Party || "",
        date: s.importedAt || null,
        place: s.place || "",
        evaluationType: s.evaluationType || "",
        bidNo: s.bidNo || "",
      }));
    }

    for (const m of masters) {
      // A master record with neither a rate/market entry nor a search
      // match for its own itemTitle still belongs in the list if the
      // search term matches one of ITS alternate names - e.g. searching
      // "hermachrodite" should surface an item whose canonical name is
      // "Caliper 15 cm" if that's the alias registered for it.
      const matchesSearch =
        !search ||
        new RegExp(search, "i").test(m.itemTitle || "") ||
        (m.alternateNames || []).some((a: string) => new RegExp(search, "i").test(a));
      if (!matchesSearch) continue;
      const r = getRow(m.itemKey, m.itemTitle);
      r.alternateNames = m.alternateNames || [];
      r.preferredRate = m.preferredRate || "";
      r.remarks = m.remarks || "";
    }

    let list = Array.from(rows.values()).sort((a, b) => {
      const aDate = a.ourDate || a.marketSamples[0]?.date || "";
      const bDate = b.ourDate || b.marketSamples[0]?.date || "";
      return new Date(bDate || 0).getTime() - new Date(aDate || 0).getTime();
    });
    list = list.slice(0, limit);

    // Pricelist suggestion - matched against pricelist_tags (an item name
    // tagged onto a supplier catalogue row, see Purchase > Pricelist) by
    // token similarity, same threshold as the Received Purchase match in
    // boq/route.ts. Capped the same way for the same reason.
    const [tags, priceItems] = await Promise.all([
      db.collection("pricelist_tags").find({}, { projection: { tag_name: 1, sku_key: 1 } }).limit(5000).toArray(),
      db
        .collection("pricelist_items")
        .find({ is_active: true }, { projection: { sku_key: 1, price: 1, supplier_name: 1 } })
        .toArray(),
    ]);
    const priceBySkuKey = new Map(priceItems.map((p: any) => [p.sku_key, p]));
    const tagRows = tags
      .map((t: any) => ({ tag_name: t.tag_name, item: priceBySkuKey.get(t.sku_key) }))
      .filter((t: any) => t.item && typeof t.item.price === "number");
    const tagTokens = tagRows.map((t: any) => tokenizeMatchText(t.tag_name || ""));

    const result = list.map((r) => {
      let pricelistRate = "";
      let pricelistSupplier = "";
      if (tagRows.length > 0) {
        const queryTokens = tokenizeMatchText(r.itemTitle);
        let bestScore = 0;
        let best: any = null;
        tagRows.forEach((t: any, i: number) => {
          const { score, overlap } = scoreTokenSimilarity(queryTokens, tagTokens[i]);
          if (score > bestScore && overlap >= 1) {
            bestScore = score;
            best = t;
          }
        });
        if (best && bestScore >= 0.5) {
          pricelistRate = String(best.item.price);
          pricelistSupplier = best.item.supplier_name || "";
        }
      }
      return { ...r, pricelistRate, pricelistSupplier };
    });

    return NextResponse.json({ rows: result });
  } catch (error: any) {
    console.error("GeM bid item-rates error:", error);
    return NextResponse.json({ error: error.message || "Failed to load item rates" }, { status: 500 });
  }
}
