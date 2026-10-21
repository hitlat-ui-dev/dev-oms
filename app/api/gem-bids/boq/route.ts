import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";
import { getFileFromR2 } from "@/lib/cloudflareR2";
import { parseBoqXlsx, normalizeItemKey } from "@/lib/documentMaker/boqEngine";
import { parseSpecificationPdf } from "@/lib/documentMaker/specEngine";
import { tokenizeMatchText, scoreTokenSimilarity } from "@/lib/gemSync/catalogueMatch";

const DB_NAME = "dev_oms_db";

// GET ?bidId= — for a BOQ bid (bidType !== "regular", the default), parses
// the bid's fetched BOQ Detail Document (see /api/gem-bids/fetch-documents)
// into its line items. For a Regular Bid (bidType === "regular" - no BOQ
// file at all, items were typed in by hand instead - see
// app/dashboard/gem-bids/document-maker/page.tsx's Fill Rates panel),
// there's nothing to parse: the already-saved boqRates themselves ARE the
// item list, returned as-is. Either way, every item gets merged with any
// rate (plus the base rate/margin % it was built from, if it was) already
// saved for THIS bid (reopening a bid you've part-filled before), and a
// rate suggestion from gem_bid_item_rate_history - the directory of rates
// saved against other bids, keyed by a normalized item title (see
// boqEngine.ts's normalizeItemKey), updated every time
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

    let items: any[];

    if (bid.bidType === "regular") {
      const itemKeys = (bid.boqRates || []).map((r: any) => normalizeItemKey(r.itemTitle));
      const historyDocs =
        itemKeys.length > 0
          ? await db.collection("gem_bid_item_rate_history").find({ itemKey: { $in: itemKeys } }).toArray()
          : [];
      const historyByKey = new Map(historyDocs.map((h: any) => [h.itemKey, h]));

      items = (bid.boqRates || []).map((r: any) => {
        const history = historyByKey.get(normalizeItemKey(r.itemTitle));
        return {
          itemNumber: r.itemNumber,
          itemTitle: r.itemTitle || "",
          itemDescription: "",
          quantity: r.quantity || "",
          unit: r.unit || "",
          consigneeId: "",
          deliveryPeriod: "",
          rate: r.rate || "",
          baseRate: r.baseRate || "",
          marginPercent: r.marginPercent || "",
          suggestedRate: history?.rate || "",
          suggestedFromBidNo: history?.bidNo || "",
        };
      });
    } else {
      if (!bid.boqDetailDoc?.fileKey) {
        return NextResponse.json({ error: "No BOQ Detail Document fetched for this bid yet" }, { status: 400 });
      }

      const boqBytes = await getFileFromR2(bid.boqDetailDoc.fileKey);
      const parsedItems = parseBoqXlsx(boqBytes);
      if (parsedItems.length === 0) {
        return NextResponse.json({ error: "Couldn't find any rows in this BOQ file" }, { status: 422 });
      }

      // Specification Document (uploaded separately - see the Fill Rates
      // panel's own Upload button) has no Item Number column of its own,
      // but its row order and Sr No both line up 1:1 with the BOQ's own
      // Item Number (same underlying GeM item list) - see specEngine.ts's
      // own comment for how its table is actually read off the PDF. A bid
      // with no Specification Document uploaded, or one specEngine
      // couldn't make sense of, just gets no specification/unit override
      // per item below - the same table as always, nothing lost.
      const specByItemNumber = new Map<string, { specification: string; unit: string }>();
      if (bid.specificationDoc?.fileKey) {
        const specBytes = await getFileFromR2(bid.specificationDoc.fileKey);
        const specRows = await parseSpecificationPdf(specBytes);
        for (const row of specRows) {
          if (row.srNo) specByItemNumber.set(row.srNo, { specification: row.specification, unit: row.unit });
        }
      }

      const savedRates: Record<string, string> = {};
      const savedBaseRates: Record<string, string> = {};
      const savedMarginPercents: Record<string, string> = {};
      for (const r of bid.boqRates || []) {
        if (!r.itemNumber) continue;
        savedRates[r.itemNumber] = r.rate;
        if (r.baseRate) savedBaseRates[r.itemNumber] = r.baseRate;
        if (r.marginPercent) savedMarginPercents[r.itemNumber] = r.marginPercent;
      }

      const itemKeys = parsedItems.map((it) => normalizeItemKey(it.itemTitle || it.itemDescription));
      const historyDocs =
        itemKeys.length > 0
          ? await db.collection("gem_bid_item_rate_history").find({ itemKey: { $in: itemKeys } }).toArray()
          : [];
      const historyByKey = new Map(historyDocs.map((h: any) => [h.itemKey, h]));

      items = parsedItems.map((it) => {
        const key = normalizeItemKey(it.itemTitle || it.itemDescription);
        const history = historyByKey.get(key);
        const spec = specByItemNumber.get(it.itemNumber);
        return {
          ...it,
          // Spec's own unit, when found, is preferred over the BOQ file's -
          // in practice they've matched in every sample seen so far, but
          // the spec is the more detailed of the two sources (e.g. "NOS
          // EACH" vs a plain "NOS") so it wins when both exist.
          unit: spec?.unit || it.unit,
          specification: spec?.specification || "",
          rate: savedRates[it.itemNumber] || "",
          baseRate: savedBaseRates[it.itemNumber] || "",
          marginPercent: savedMarginPercents[it.itemNumber] || "",
          suggestedRate: history?.rate || "",
          suggestedFromBidNo: history?.bidNo || "",
        };
      });
    }

    // Market-rate suggestion (see lib/documentMaker/marketRateEngine.ts) -
    // a second, independent suggestion from real GeM result data imported
    // via /api/gem-bids/market-rates/import, layered on top of the
    // suggestedRate above (our own past quote for this item) rather than
    // replacing it - "what we charged before" and "what actually won" are
    // both useful context and can disagree. The headline number is the
    // MOST RECENT result, not an average across every sample ever
    // imported - an average blurs a genuine price trend (steadily rising
    // or falling) into one static number, which is exactly the thing a
    // trend view is for. Up to 5 most recent samples (full breakdown:
    // rate/date/place/evaluation type/L1 party) ride along for the
    // frontend's hover table, newest first.
    const marketItemKeys = items.map((it) => normalizeItemKey(it.itemTitle)).filter(Boolean);
    if (marketItemKeys.length > 0) {
      const marketDocs = await db
        .collection("gem_bid_item_market_rate_history")
        .find({ itemKey: { $in: marketItemKeys } })
        .sort({ importedAt: -1 })
        .toArray();
      const marketByKey = new Map<string, any[]>();
      for (const d of marketDocs) {
        const list = marketByKey.get(d.itemKey) || [];
        list.push(d);
        marketByKey.set(d.itemKey, list);
      }
      items = items.map((it) => {
        const samples = marketByKey.get(normalizeItemKey(it.itemTitle));
        if (!samples || samples.length === 0) return it;
        const latest = samples[0];
        return {
          ...it,
          marketRate: String(latest.l1Rate),
          marketRateSampleCount: samples.length,
          marketRateSamples: samples.slice(0, 5).map((s) => ({
            rate: s.l1Rate,
            party: s.l1Party || "",
            date: s.importedAt || null,
            place: s.place || "",
            evaluationType: s.evaluationType || "",
            bidNo: s.bidNo || "",
          })),
        };
      });
    }

    // Purchase-cost suggestion (shown under Base Rate, not Rate - this is
    // what WE actually paid a vendor for this item, per the "Received
    // Purchase" ledger, not what we'd charge GeM). Matched by token
    // similarity rather than an exact/normalized-key match like
    // suggestedRate/marketRate above, since a Received Purchase itemName
    // ("M S FLAT 50 X 6 MM") and a GeM BOQ item title are two completely
    // independently-typed strings with no shared history the way two GeM
    // bids' own item titles do - same 0.5-score/≥1-overlap threshold
    // already established for exactly this kind of cross-system item-name
    // matching in gem-sync/catalogue (see catalogueMatch.ts). Capped and
    // sorted newest-first so a tie between two matches of equal score
    // favors the more recent purchase.
    const purchaseDocs = await db
      .collection("Received purchase")
      .find({ itemName: { $exists: true, $ne: "" } }, { projection: { itemName: 1, rate: 1, vendor: 1, receivedAt: 1 } })
      .sort({ receivedAt: -1 })
      .limit(5000)
      .toArray();
    if (purchaseDocs.length > 0) {
      const purchaseTokens = purchaseDocs.map((p: any) => tokenizeMatchText(p.itemName || ""));
      items = items.map((it) => {
        const queryTokens = tokenizeMatchText(it.itemTitle || "");
        if (queryTokens.length === 0) return it;
        let best: any = null;
        let bestScore = 0;
        purchaseDocs.forEach((p: any, i: number) => {
          const { score, overlap } = scoreTokenSimilarity(queryTokens, purchaseTokens[i]);
          if (score > bestScore && overlap >= 1) {
            bestScore = score;
            best = p;
          }
        });
        if (!best || bestScore < 0.5 || typeof best.rate !== "number") return it;
        return {
          ...it,
          purchaseRate: String(best.rate),
          purchaseVendor: best.vendor || "",
          purchaseDate: best.receivedAt || null,
        };
      });
    }

    return NextResponse.json({ items });
  } catch (error: any) {
    console.error("GeM bid BOQ parse error:", error);
    return NextResponse.json({ error: error.message || "Failed to parse BOQ" }, { status: 500 });
  }
}
