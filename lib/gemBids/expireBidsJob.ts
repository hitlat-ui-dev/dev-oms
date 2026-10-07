import { AUTO_DELETE_EXPIRED_SECTIONS } from "./columns";
import { parseGemDate } from "./expirySweep";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const SETTINGS_COLLECTION = "gem_bid_settings";
const LAST_RUN_KEY = "lastExpireBidsJobDate";

export interface ExpireBidsJobResult {
  ran: boolean;
  reason?: string;
  expiredCount?: number;
  purgedCount?: number;
}

/**
 * The once-daily, evening-only move-to-Expired-Bids + 7-day purge job -
 * fired from app/layout.tsx on every site visit (same pattern as /api/
 * backup/auto, /api/courier/auto, and /api/gem-bids/purge-deleted), but
 * gated on local hour so it only actually does anything on an evening
 * visit, not whenever someone first opens the OMS that day. A bid's own
 * expiry no longer happens per-sync (see expirySweep.ts's comment) -
 * batching it into one evening pass is what "Expired Bids" as a dated
 * holding section (new bids can still arrive for the same real-world
 * tender up to its own close) actually implies.
 */
export async function runExpireBidsJobIfDue(db: any, eveningHour = 18): Promise<ExpireBidsJobResult> {
  const now = new Date();
  if (now.getHours() < eveningHour) {
    return { ran: false, reason: "not evening yet" };
  }

  const todayKey = now.toISOString().slice(0, 10);
  const settingsCollection = db.collection(SETTINGS_COLLECTION);
  const settingsDoc = await settingsCollection.findOne({ key: LAST_RUN_KEY });
  if (settingsDoc?.date === todayKey) {
    return { ran: false, reason: "already ran today" };
  }

  const bidsCollection = db.collection("gem_bids");

  // Move to Expired Bids: every bid in a section where auto-expiry is safe
  // (new_bids/fetched_bid_data - a bid actively being worked, Bids to Fill
  // onward, is left alone even past its own end date, same carve-out the
  // old per-sync sweep always had), not already expired/deleted, whose Bid
  // End Date/Time has passed. bidEndDateTime is a free-text string, not
  // reliably comparable via a Mongo query operator, so every candidate is
  // fetched and checked in JS.
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
    { $set: { key: LAST_RUN_KEY, date: todayKey, expiredCount, purgedCount, ranAt: now } },
    { upsert: true }
  );

  return { ran: true, expiredCount, purgedCount };
}
