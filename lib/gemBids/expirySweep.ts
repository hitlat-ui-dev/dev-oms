const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// GeM's exported Bid End Date/Time is always "DD-MM-YYYY HH:mm:ss" (24h clock),
// e.g. "19-08-2026 14:00:00" - confirmed against real stored data, not assumed.
// Note this differs from Start Date's own format ("DD-MM-YYYY h:mm A", 12h with
// AM/PM) - the two fields are never parsed with the same helper.
export function parseGemDate(value?: string | null): Date | null {
  if (!value) return null;
  const m = String(value).trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, dd, mo, yyyy, hh, mi, ss] = m;
  const d = new Date(Number(yyyy), Number(mo) - 1, Number(dd), Number(hh), Number(mi), Number(ss));
  return isNaN(d.getTime()) ? null : d;
}

export interface SweepResult {
  promotedCount: number;
  // No longer computed here - see expireBidsJob.ts's own once-daily sweep.
  // Kept on the result/stats shape for backward compatibility with the
  // last-run stats panel rather than threading a type change through every
  // caller for a field that's always 0 now.
  expiredDeletedCount: number;
}

/**
 * Runs after every apply (see applyImport.ts): promotes New Bids past their
 * 24h staging window into Fetched Bid Data (flagged so the UI can show the
 * one-time blue background), and clears highlight flags that have aged out.
 * Expiry (Bid End Date/Time has passed) used to also be handled here, as an
 * immediate hard-delete on every sync - moved to expireBidsJob.ts's own
 * once-daily sweep instead, which soft-moves into a 7-day-retention Expired
 * Bids holding section rather than deleting outright (same reasoning as
 * Deleted Bids' own retention window - an immediate hard-delete gave no
 * chance to notice/undo a bid expiring at a bad time).
 */
export async function runExpirySweep(db: any): Promise<SweepResult> {
  const bidsCollection = db.collection("gem_bids");
  const now = new Date();
  const dayAgo = new Date(now.getTime() - ONE_DAY_MS);

  // 1. Promote New Bids older than 24h.
  const toPromote = await bidsCollection
    .find({ currentSection: "new_bids", firstSeenAt: { $lte: dayAgo } })
    .project({ bidNo: 1 })
    .toArray();
  let promotedCount = 0;
  if (toPromote.length > 0) {
    const res = await bidsCollection.updateMany(
      { bidNo: { $in: toPromote.map((b: any) => b.bidNo) } },
      { $set: { currentSection: "fetched_bid_data", justPromoted: true, promotedAt: now, updatedAt: now } }
    );
    promotedCount = res.modifiedCount || toPromote.length;
  }

  // 2. Clear highlight flags that have aged past 24h.
  await bidsCollection.updateMany(
    { justPromoted: true, promotedAt: { $lte: dayAgo } },
    { $set: { justPromoted: false } }
  );
  await bidsCollection.updateMany(
    { "changedFields.0": { $exists: true }, lastChangedAt: { $lte: dayAgo } },
    { $set: { changedFields: [], hasPendingUpdate: false } }
  );

  return { promotedCount, expiredDeletedCount: 0 };
}
