import { DATA_FIELD_KEYS, computeHighlight, isExcludedByCategory, SYNC_PROTECTED_SECTIONS } from "./columns";
import { diffBidFields, normalizeForCompare } from "./diffEngine";
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
  protectedSkippedCount: number;
  tombstoneSkippedCount: number;
  fieldConflictCount: number;
  runId: string;
}

/**
 * The one place that turns a freshly-scraped batch of GeM bid rows into live
 * gem_bids state — category exclusion, new-vs-changed-vs-unchanged diffing/
 * tagging, and the expiry/promotion sweep, all as one call so every caller
 * (manual xlsx import, the extension's direct POST, and the sync/apply route)
 * gets identical behavior. See lib/gemBids/columns.ts and diffEngine.ts for
 * the field list and compare rules this builds on.
 *
 * Batched rather than per-row: one $in fetch for every existing doc this
 * batch could touch, then a single bulkWrite for every insert/update, instead
 * of a sequential findOne+insert/update per row. A few-thousand-row sync
 * used to mean a few-thousand sequential DB round trips — slow enough to
 * exceed the apply route's serverless execution limit and leave the run
 * stuck at status "applying" forever with no way to recover short of a
 * manual DB edit (see sync/stop/route.ts's "applying" recovery path, added
 * as a safety net for if this ever happens again anyway).
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
    protectedSkippedCount: 0,
    tombstoneSkippedCount: 0,
    importedBy: userName || "",
  });
  const runId = runResult.insertedId;

  // Pass 1 (in memory, no DB calls): normalize rows, apply category
  // exclusion, and dedup by bidNo (last row for a given bidNo wins, matching
  // what a sequential pass would end up with).
  let excludedCount = 0;
  const incomingByBidNo = new Map<string, Record<string, string>>();
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
    incomingByBidNo.set(bidNo, incoming);
  }

  // One round trip for every existing doc this batch could touch.
  const bidNos = Array.from(incomingByBidNo.keys());
  const existingDocs = bidNos.length > 0 ? await bidsCollection.find({ bidNo: { $in: bidNos } }).toArray() : [];
  const existingByBidNo = new Map<string, any>(existingDocs.map((d: any) => [d.bidNo, d]));

  // A bid the user deleted stays excluded from every future sync - even
  // once its 7-day soft-delete window has passed and the live gem_bids doc
  // is gone for good - unless GeM's own data for it has genuinely changed
  // since the delete (the tombstone's snapshot is what it looked like at
  // that moment, compared field-by-field below). See app/api/gem-bids/
  // route.ts's DELETE handler for where these get written.
  const tombstonesCollection = db.collection("gem_bid_tombstones");
  const tombstoneDocs =
    bidNos.length > 0 ? await tombstonesCollection.find({ bidNo: { $in: bidNos } }).toArray() : [];
  const tombstoneByBidNo = new Map<string, any>(tombstoneDocs.map((t: any) => [t.bidNo, t]));

  let newCount = 0;
  let updatedCount = 0;
  let oldCount = 0;
  let protectedSkippedCount = 0;
  let tombstoneSkippedCount = 0;
  let fieldConflictCount = 0;
  const changeHistoryDocs: any[] = [];
  const bulkOps: any[] = [];

  // Pass 2 (in memory): decide insert/update/skip per bid and queue it as a
  // bulk op, instead of awaiting each one.
  for (const [bidNo, incoming] of incomingByBidNo) {
    const existing = existingByBidNo.get(bidNo);

    // Submitted Bids is off-limits to every automated touch a sync makes -
    // no field refresh, no re-tag, nothing - once a bid is here, only a
    // manual action in the OMS itself (Edit Bid, Bid Status, or a manual
    // Delete) can change it, even if GeM's own listing for it changed.
    if (existing && SYNC_PROTECTED_SECTIONS.includes(existing.currentSection)) {
      protectedSkippedCount++;
      continue;
    }

    // Still inside its 7-day soft-delete window - frozen in place, same as
    // a protected section, so it doesn't un-delete itself or get its
    // fields silently refreshed while sitting in Deleted Bids.
    if (existing && existing.deletedAt) {
      tombstoneSkippedCount++;
      continue;
    }

    // Sitting in Expired Bids - also frozen in place, UNLESS GeM's own Bid
    // End Date/Time for it has genuinely changed (extended/moved) since it
    // expired, in which case it's pulled back into Fetched Bid Data with
    // the Updated badge (handled below, once diffBidFields confirms the
    // date is what changed) rather than staying expired forever even
    // though GeM itself has revived the tender.
    let unexpiring = false;
    if (existing && existing.expiredAt) {
      const dateChanged = normalizeForCompare(existing.bidEndDateTime) !== normalizeForCompare(incoming.bidEndDateTime);
      if (!dateChanged) {
        tombstoneSkippedCount++;
        continue;
      }
      unexpiring = true;
    }

    // Not currently in gem_bids at all (soft-delete window has lapsed and
    // it was purged, or purged by an older flow) - a tombstone means it was
    // deliberately deleted, so it only comes back if GeM's data for it has
    // actually changed since that delete.
    if (!existing) {
      const tombstone = tombstoneByBidNo.get(bidNo);
      if (tombstone) {
        const changedSinceDelete = DATA_FIELD_KEYS.some(
          (k) => normalizeForCompare(tombstone.snapshot?.[k]) !== normalizeForCompare(incoming[k])
        );
        if (!changedSinceDelete) {
          tombstoneSkippedCount++;
          continue;
        }
      }
    }

    const isHighlighted = computeHighlight(incoming.items);

    if (!existing) {
      bulkOps.push({
        insertOne: {
          document: {
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
          },
        },
      });
      newCount++;
      continue;
    }

    // A field the user has manually corrected (Edit Bid) keeps that value on
    // every future sync, rather than GeM's own data for it silently winning
    // back on the next scrape - substituted back to the existing (user's)
    // value before diffing/building setDoc, so it's treated as unchanged no
    // matter what GeM says. If GeM's current value for that field has
    // actually diverged from the user's edit since the edit was made, that's
    // flagged (hasFieldConflict/fieldConflicts) rather than silently
    // dropped, so the user can go decide whether to keep their edit or
    // accept GeM's newer data - never resolved automatically either way.
    const manuallyEditedFields: string[] = existing.manuallyEditedFields || [];
    const fieldConflicts: { field: string; yourValue: string; gemValue: string }[] = [];
    const effectiveIncoming = { ...incoming };
    for (const field of manuallyEditedFields) {
      const gemValue = incoming[field];
      const yourValue = existing[field];
      if (normalizeForCompare(gemValue) !== normalizeForCompare(yourValue)) {
        fieldConflicts.push({ field, yourValue: String(yourValue ?? ""), gemValue: String(gemValue ?? "") });
      }
      effectiveIncoming[field] = yourValue;
    }
    if (fieldConflicts.length > 0) fieldConflictCount++;

    const changed = diffBidFields(existing, effectiveIncoming);
    if (changed.length === 0) {
      bulkOps.push({
        updateOne: {
          filter: { bidNo },
          update: {
            $set: {
              tag: "Old",
              lastSeenRun: runAt,
              updatedAt: runAt,
              hasFieldConflict: fieldConflicts.length > 0,
              fieldConflicts,
            },
          },
        },
      });
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
      ...effectiveIncoming,
      isHighlighted,
      tag: "Updated/Extended",
      lastSeenRun: runAt,
      updatedAt: runAt,
      changedFields: changed.map((c) => c.field),
      lastChangedAt: runAt,
      hasFieldConflict: fieldConflicts.length > 0,
      fieldConflicts,
    };
    // A bid already progressed past section 1 keeps its place — fields refresh in place,
    // just flagged with the "Updated" badge, instead of being pulled back to section 1.
    if (existing.currentSection !== "fetched_bid_data") {
      setDoc.hasPendingUpdate = true;
    }
    const updateOp: Record<string, any> = { $set: setDoc };
    if (unexpiring) {
      // GeM's own date for it moved - back into New Bids (not wherever it
      // happened to be sitting before it expired), tag already "Updated/
      // Extended" above per spec. firstSeenAt is reset to this run too, so
      // it gets its own fresh 24h New Bids staging window instead of
      // runExpirySweep (which checks firstSeenAt age, not section-entry
      // time) immediately re-promoting it straight past New Bids using its
      // original, months-old firstSeenAt.
      setDoc.currentSection = "new_bids";
      setDoc.firstSeenAt = runAt;
      setDoc.hasPendingUpdate = true;
      updateOp.$unset = { expiredAt: "" };
    }
    bulkOps.push({ updateOne: { filter: { bidNo }, update: updateOp } });
    updatedCount++;
  }

  if (bulkOps.length > 0) {
    await bidsCollection.bulkWrite(bulkOps, { ordered: false });
  }
  if (changeHistoryDocs.length > 0) {
    await changeHistoryCollection.insertMany(changeHistoryDocs);
  }

  const { promotedCount, expiredDeletedCount } = await runExpirySweep(db);

  await runsCollection.updateOne(
    { _id: runId },
    {
      $set: {
        newCount,
        updatedCount,
        oldCount,
        excludedCount,
        promotedCount,
        expiredDeletedCount,
        protectedSkippedCount,
        tombstoneSkippedCount,
        fieldConflictCount,
      },
    }
  );

  return {
    newCount,
    updatedCount,
    oldCount,
    excludedCount,
    promotedCount,
    expiredDeletedCount,
    protectedSkippedCount,
    tombstoneSkippedCount,
    fieldConflictCount,
    runId: runId.toString(),
  };
}
