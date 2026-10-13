import { AUTO_DELETE_EXPIRED_SECTIONS } from "./columns";
import { parseGemDate } from "./expirySweep";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const SETTINGS_COLLECTION = "gem_bid_settings";
const LAST_RUN_KEY = "lastExpireBidsJobDate";
// How often this actually does the (cheap, but not free) full-section scan
// - there's no real cron here, just a check fired from app/layout.tsx on
// every site visit (see that file), so this is what stands in for "real
// time": frequent enough that a bid moves to Expired Bids within minutes
// of its own deadline during a normal work day, without re-scanning on
// literally every page navigation.
const MIN_INTERVAL_MS = 15 * 60 * 1000;

export interface ExpireBidsJobResult {
  ran: boolean;
  reason?: string;
  expiredCount?: number;
  purgedCount?: number;
}

/**
 * The move-to-Expired-Bids + 7-day purge check - fired from app/layout.tsx
 * on every site visit (same pattern as /api/backup/auto, /api/courier/auto,
 * and /api/gem-bids/purge-deleted), self-throttled to once every
 * MIN_INTERVAL_MS rather than tied to a time of day - used to be
 * evening-only (once a bid's own expiry stopped happening per-sync, see
 * expirySweep.ts's comment), which meant a bid could sit visibly "live"
 * for up to a day past its real deadline; reworked to run all day instead
 * so a bid moves to Expired Bids within minutes of actually expiring,
 * whenever someone happens to have the OMS open.
 */
export async function runExpireBidsJobIfDue(db: any): Promise<ExpireBidsJobResult> {
  const now = new Date();

  const settingsCollection = db.collection(SETTINGS_COLLECTION);
  const settingsDoc = await settingsCollection.findOne({ key: LAST_RUN_KEY });
  if (settingsDoc?.ranAt && now.getTime() - new Date(settingsDoc.ranAt).getTime() < MIN_INTERVAL_MS) {
    return { ran: false, reason: "checked recently" };
  }

  const bidsCollection = db.collection("gem_bids");

  // Move to Expired Bids: every bid in AUTO_DELETE_EXPIRED_SECTIONS (New
  // Bids, Fetched Bid Data, Bids to Fill - NOT Submitted Bids, deliberately
  // excluded: once a bid is submitted its lifecycle is manual from there,
  // see columns.ts's own comment on AUTO_DELETE_EXPIRED_SECTIONS), not
  // already expired/deleted, whose Bid End Date/Time has passed.
  // bidEndDateTime is a free-text string, not reliably comparable via a
  // Mongo query operator, so every candidate is fetched and checked in JS.
  const candidates = await bidsCollection
    .find({
      currentSection: { $in: AUTO_DELETE_EXPIRED_SECTIONS },
      expiredAt: { $exists: false },
      deletedAt: { $exists: false },
    })
    .project({ bidNo: 1, bidEndDateTime: 1 })
    .toArray();
  const expiredBidNos = candidates
    .filter((b: any) => {
      const end = parseGemDate(b.bidEndDateTime);
      return end !== null && end.getTime() < now.getTime();
    })
    .map((b: any) => b.bidNo);

  let expiredCount = 0;
  if (expiredBidNos.length > 0) {
    const res = await bidsCollection.updateMany({ bidNo: { $in: expiredBidNos } }, { $set: { expiredAt: now } });
    expiredCount = res.modifiedCount || 0;
  }

  // Purge: any bid whose Expired Bids 7-day window has already passed -
  // same retention mechanic as /api/gem-bids/purge-deleted, just keyed off
  // expiredAt instead of deletedAt. No tombstone here (unlike a manual
  // delete) - a bid that expired and was never worked has nothing to
  // protect against re-appearing; the normal sync-vs-existing-doc logic
  // already means a still-live bid just gets re-inserted as new.
  const purgeCutoff = new Date(now.getTime() - SEVEN_DAYS_MS);
  const purgeResult = await bidsCollection.deleteMany({ expiredAt: { $lte: purgeCutoff } });
  const purgedCount = purgeResult.deletedCount || 0;

  await settingsCollection.updateOne(
    { key: LAST_RUN_KEY },
    { $set: { key: LAST_RUN_KEY, expiredCount, purgedCount, ranAt: now } },
    { upsert: true }
  );

  return { ran: true, expiredCount, purgedCount };
}
