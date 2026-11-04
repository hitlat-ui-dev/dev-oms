import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";
import { RESULT_OPTIONS } from "@/lib/gemBids/bidSummaryOptions";

const DB_NAME = "dev_oms_db";

// GET — one bid-level row per party actually assigned to it (selectedPartyIds,
// falling back to the older selectedPartyId), for the Bid Summary page: Bid
// No, last date, item, the institute guess (resolved client-side, same as
// Final Rates), evaluation/RA type and, per firm, its own Result/Remark
// (summaryByParty, keyed by that firm's company _id) and Final Rate - the
// grand total of this bid's saved rates, bumped by that firm's own BOQ Rate
// Variant % if Document Maker's Variant tab assigned one (boqVariantPartyPercents,
// see boq/save-variants/route.ts) or just the plain L1 total otherwise, since
// variant 1/no-variant-assigned both mean "exactly what was filled in Rate".
// Scoped to bids_to_fill + submitted_bids - raw new/fetched scrape data has
// no firm/result to summarize yet, and a deleted bid is gone either way.
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const bids = await db
      .collection("gem_bids")
      .find(
        { currentSection: { $in: ["bids_to_fill", "submitted_bids"] }, deletedAt: { $exists: false } },
        {
          projection: {
            bidNo: 1,
            bidLink: 1,
            bidEndDateTime: 1,
            items: 1,
            address: 1,
            evaluationMethod: 1,
            bidToRaEnabled: 1,
            raQualificationRule: 1,
            selectedPartyIds: 1,
            selectedPartyId: 1,
            boqRates: 1,
            boqVariantPartyPercents: 1,
            summaryByParty: 1,
          },
        }
      )
      .toArray();

    const result = bids.map((b: any) => {
      const partyIds: string[] = b.selectedPartyIds?.length ? b.selectedPartyIds : b.selectedPartyId ? [b.selectedPartyId] : [];
      const percents: Record<string, number> = b.boqVariantPartyPercents || {};
      const baseTotal = (b.boqRates || []).reduce((sum: number, r: any) => {
        const qty = parseFloat(r.quantity) || 0;
        const rate = parseFloat(r.rate) || 0;
        return sum + qty * rate;
      }, 0);
      const finalRateByParty: Record<string, number> = {};
      for (const pid of partyIds) {
        const pct = percents[pid] || 0;
        finalRateByParty[pid] = pct
          ? (b.boqRates || []).reduce((sum: number, r: any) => {
              const qty = parseFloat(r.quantity) || 0;
              const rate = parseFloat(r.rate) || 0;
              return sum + qty * (rate * (1 + pct / 100));
            }, 0)
          : baseTotal;
      }
      return {
        _id: b._id,
        bidNo: b.bidNo,
        bidLink: b.bidLink || "",
        bidEndDateTime: b.bidEndDateTime || "",
        items: b.items || "",
        address: b.address || "",
        evaluationMethod: b.evaluationMethod || "",
        bidToRaEnabled: b.bidToRaEnabled || "",
        raQualificationRule: b.raQualificationRule || "",
        partyIds,
        hasRates: (b.boqRates || []).some((r: any) => String(r.rate || "").trim()),
        baseTotal,
        finalRateByParty,
        summaryByParty: b.summaryByParty || {},
      };
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("GeM bid summary error:", error);
    return NextResponse.json({ error: error.message || "Failed to load bid summary" }, { status: 500 });
  }
}

// PATCH { bidId, partyId, result?, remark? } — updates just that one firm's
// Result and/or Remark on this bid (summaryByParty.<partyId>, a per-firm map
// rather than a single bid-level field, since the same bid can be submitted
// under several of our own firms at once and each one's own evaluation can
// land differently - see page.tsx's own comment for the full reasoning).
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { bidId, partyId, result, remark } = body;
    if (!bidId || !ObjectId.isValid(bidId)) {
      return NextResponse.json({ error: "Valid bidId is required" }, { status: 400 });
    }
    if (!partyId || typeof partyId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(partyId)) {
      return NextResponse.json({ error: "Valid partyId is required" }, { status: 400 });
    }
    if (result !== undefined && result !== "" && !RESULT_OPTIONS.includes(result)) {
      return NextResponse.json({ error: "Invalid result value" }, { status: 400 });
    }

    const setDoc: Record<string, any> = {};
    if (result !== undefined) setDoc[`summaryByParty.${partyId}.result`] = result;
    if (remark !== undefined) setDoc[`summaryByParty.${partyId}.remark`] = String(remark);
    if (Object.keys(setDoc).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const res = await db.collection("gem_bids").updateOne({ _id: new ObjectId(bidId) }, { $set: setDoc });
    if (res.matchedCount === 0) {
      return NextResponse.json({ error: "Bid not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("GeM bid summary update error:", error);
    return NextResponse.json({ error: error.message || "Failed to update" }, { status: 500 });
  }
}
