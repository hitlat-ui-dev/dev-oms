import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { DATA_FIELD_KEYS, computeHighlight } from "@/lib/gemBids/columns";
import { diffBidFields } from "@/lib/gemBids/diffEngine";

const DB_NAME = "dev_oms_db";

// The GeM Bid Exporter extension's popup posts here directly (chrome-extension:// origin),
// same CORS convention already used by the other extension-facing routes (gem-orders, seller-orders).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// POST: import a freshly-fetched batch of GeM bid rows — either parsed client-side from the
// extension's .xlsx export, or posted directly by the extension's "Send to OMS" button
// (body.source: "xlsx_import" | "extension_direct"). Either way this runs the same three-way
// diff/tag engine against what's already stored — keyed on Bid No, never duplicated. See
// lib/gemBids/diffEngine.ts for the compare rules and the plan doc for the full
// New Published / Old / Updated-Extended algorithm.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { rows, fileName, userName, source } = body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "rows are required" }, { status: 400, headers: corsHeaders });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const bidsCollection = db.collection("gem_bids");
    const runsCollection = db.collection("gem_bid_runs");
    const changeHistoryCollection = db.collection("gem_bid_change_history");

    await bidsCollection.createIndex({ bidNo: 1 }, { unique: true });

    const runAt = new Date();
    const runResult = await runsCollection.insertOne({
      runAt,
      source: source === "extension_direct" ? "extension_direct" : "xlsx_import",
      fileName: fileName || "",
      totalRows: rows.length,
      newCount: 0,
      updatedCount: 0,
      oldCount: 0,
      importedBy: userName || "",
    });
    const runId = runResult.insertedId;

    let newCount = 0;
    let updatedCount = 0;
    let oldCount = 0;
    const changeHistoryDocs: any[] = [];

    for (const row of rows) {
      const bidNo = String(row.bidNo || "").trim();
      if (!bidNo) continue;

      const incoming: Record<string, string> = { bidNo };
      for (const key of DATA_FIELD_KEYS) incoming[key] = String(row[key] ?? "").trim();
      const isHighlighted = computeHighlight(incoming.items);

      const existing = await bidsCollection.findOne({ bidNo });

      if (!existing) {
        await bidsCollection.insertOne({
          ...incoming,
          isHighlighted,
          tag: "New Published",
          currentSection: "fetched_bid_data",
          sectionStack: [],
          hasPendingUpdate: false,
          selectedPartyId: null,
          selectedBidType: null,
          bidSpecificAtc: { fileKey: null, source: null, fetchedAt: null },
          generation: { status: "not_generated", zipFileKey: null, generatedAt: null, error: null },
          firstSeenRun: runAt,
          lastSeenRun: runAt,
          createdAt: runAt,
          updatedAt: runAt,
        });
        newCount++;
        continue;
      }

      const changed = diffBidFields(existing, incoming);
      if (changed.length === 0) {
        await bidsCollection.updateOne({ bidNo }, { $set: { tag: "Old", lastSeenRun: runAt, updatedAt: runAt } });
        oldCount++;
        continue;
      }

      changeHistoryDocs.push(
        ...changed.map((c) => ({
          bidNo,
          runId,
          fieldChanged: c.field,
          oldValue: c.oldValue,
          newValue: c.newValue,
          runTimestamp: runAt,
        }))
      );

      const setDoc: Record<string, any> = {
        ...incoming,
        isHighlighted,
        tag: "Updated/Extended",
        lastSeenRun: runAt,
        updatedAt: runAt,
      };
      // A bid already progressed past section 1 keeps its place — fields refresh in place,
      // just flagged with the "Updated" badge, instead of being pulled back to section 1.
      if (existing.currentSection !== "fetched_bid_data") {
        setDoc.hasPendingUpdate = true;
      }
      await bidsCollection.updateOne({ bidNo }, { $set: setDoc });
      updatedCount++;
    }

    if (changeHistoryDocs.length > 0) {
      await changeHistoryCollection.insertMany(changeHistoryDocs);
    }
    await runsCollection.updateOne({ _id: runId }, { $set: { newCount, updatedCount, oldCount } });

    return NextResponse.json({ newCount, updatedCount, oldCount, runId: runId.toString() }, { headers: corsHeaders });
  } catch (error: any) {
    console.error("GeM bid import error:", error);
    return NextResponse.json({ error: error.message || "Import failed" }, { status: 500, headers: corsHeaders });
  }
}
