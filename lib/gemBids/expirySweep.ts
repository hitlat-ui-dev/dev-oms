import { AUTO_DELETE_EXPIRED_SECTIONS } from "./columns";

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
  expiredDeletedCount: number;
}

/**
 * Runs after every apply (see applyImport.ts): promotes New Bids past their 24h
 * staging window into Fetched Bid Data (flagged so the UI can show the one-time
 * blue background), deletes bids whose Bid End Date/Time has passed in the
 * sections where that's safe (see AUTO_DELETE_EXPIRED_SECTIONS), and clears
 * highlight flags that have aged out.
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

  // 2. Delete expired bids, only in sections where auto-delete is safe. Every
  // remaining bid in those sections is fetched and checked in JS (bidEndDateTime
  // is a free-text string, not reliably comparable via a Mongo query operator).
  const candidates = await bidsCollection
    .find({ currentSection: { $in: AUTO_DELETE_EXPIRED_SECTIONS } })
    .project({ bidNo: 1, bidEndDateTime: 1 })
    .toArray();
  const expiredBidNos = candidates
    .filter((b: any) => {
      const end = parseGemDate(b.bidEndDateTime);
      return end !== null && end.getTime() < now.getTime();
    })
    .map((b: any) => b.bidNo);
  let expiredDeletedCount = 0;
  if (expiredBidNos.length > 0) {
    const res = await bidsCollection.deleteMany({ bidNo: { $in: expiredBidNos } });
    expiredDeletedCount = res.deletedCount || 0;
  }

  // 3. Clear highlight flags that have aged past 24h.
  await bidsCollection.updateMany(
    { justPromoted: true, promotedAt: { $lte: dayAgo } },
    { $set: { justPromoted: false } }
  );
  await bidsCollection.updateMany(
    { "changedFields.0": { $exists: true }, lastChangedAt: { $lte: dayAgo } },
    { $set: { changedFields: [], hasPendingUpdate: false } }
  );

  return { promotedCount, expiredDeletedCount };
}
