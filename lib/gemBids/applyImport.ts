import { DATA_FIELD_KEYS, computeHighlight, isExcludedByCategory } from "./columns";
import { diffBidFields } from "./diffEngine";
import { runExpirySweep } from "./expirySweep";

export interface ApplyImportInput {
  rows: any[];
  fileName?: string;
  userName?: string;
  source?: "xlsx_import" | "extension_direct";
}

export interface ApplyImportResult {
  newCount: number;
  updatedCount: number;
  oldCount: number;
  excludedCount: number;
  promotedCount: number;
  expiredDeletedCount: number;
  runId: string;
}

/**
 * The one place that turns a freshly-scraped batch of GeM bid rows into live
 * gem_bids state — category exclusion, new-vs-changed-vs-unchanged diffing/
 * tagging, and the expiry/promotion sweep, all as one call so every caller
 * (manual xlsx import, the extension's direct POST, and the sync/apply route)
 * gets identical behavior. See lib/gemBids/columns.ts and diffEngine.ts for
 * the field list and compare rules this builds on.
 */
export async function applyImport(db: any, input: ApplyImportInput): Promise<ApplyImportResult> {
  const { rows, fileName, userName, source } = input;
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
    excludedCount: 0,
    promotedCount: 0,
    expiredDeletedCount: 0,
    importedBy: userName || "",
  });
  const runId = runResult.insertedId;

  let newCount = 0;
  let updatedCount = 0;
  let oldCount = 0;
  let excludedCount = 0;
  const changeHistoryDocs: any[] = [];

  for (const row of rows) {
    const bidNo = String(row.bidNo || "").trim();
    if (!bidNo) continue;

    const incoming: Record<string, string> = { bidNo };
    for (const key of DATA_FIELD_KEYS) incoming[key] = String(row[key] ?? "").trim();

    // Category exclusion runs before anything else touches gem_bids - an
    // excluded bid never gets inserted, and an already-excluded-category bid
    // that somehow got in earlier is left alone (exclusion only guards new
    // inserts here, matching the spec's "before a bid is added to any tab").
    if (isExcludedByCategory(incoming.items)) {
      excludedCount++;
      continue;
    }

    const isHighlighted = computeHighlight(incoming.items);
    const existing = await bidsCollection.findOne({ bidNo });

    if (!existing) {
      await bidsCollection.insertOne({
        ...incoming,
        isHighlighted,
        tag: "New Published",
        currentSection: "new_bids",
        sectionStack: [],
        hasPendingUpdate: false,
        changedFields: [],
        lastChangedAt: null,
        firstSeenAt: runAt,
        justPromoted: false,
        promotedAt: null,
        submittedStatus: null,
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
      changedFields: changed.map((c) => c.field),
      lastChangedAt: runAt,
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

  const { promotedCount, expiredDeletedCount } = await runExpirySweep(db);

  await runsCollection.updateOne(
    { _id: runId },
    { $set: { newCount, updatedCount, oldCount, excludedCount, promotedCount, expiredDeletedCount } }
  );

  return { newCount, updatedCount, oldCount, excludedCount, promotedCount, expiredDeletedCount, runId: runId.toString() };
}
