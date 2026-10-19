import { getFileFromR2, uploadFileToR2 } from "@/lib/cloudflareR2";
import { extractOrderItemLinks } from "@/lib/documentMaker/linkExtractEngine";

const SETTINGS_COLLECTION = "gem_bid_settings";
const LAST_RUN_KEY = "lastAutoDocLinksJobDate";
const MIN_INTERVAL_MS = 2 * 60 * 1000;
const ENQUEUE_BATCH_SIZE = 10;
const EXTRACT_BATCH_SIZE = 5;

export interface AutoDocLinksJobResult {
  ran: boolean;
  reason?: string;
  queuedForFetch?: number;
  extracted?: number;
}

async function fetchPublicDoc(url: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buffer = Buffer.from(await resp.arrayBuffer());
    return { buffer, contentType: resp.headers.get("content-type") || "application/octet-stream" };
  } catch {
    return null;
  }
}

/**
 * Self-throttled, site-visit-triggered (see app/layout.tsx), same pattern
 * as runExpireBidsJobIfDue. Automatic for every Bids to Fill/Submitted
 * Bids bid, by request - an earlier version of this gated it behind a
 * manual "Fetch Documents" selection, which was reverted: every bid should
 * already show BOQ Rates/BOQ Specifications the same way a manual upload
 * always has, with no extra click needed. Two steps each run:
 *
 * 1. Queue a Bid Document fetch (docFetch, same mechanism Generate ATC
 *    already uses) for any bid that doesn't have one yet - GeM blocks
 *    non-browser requests for the Bid Document itself, so this can only be
 *    queued here, not fetched directly; the extension's existing
 *    background worker (already polling for pending docFetch jobs) picks
 *    it up. A bid that already has its Bid Document (a prior sync already
 *    queued and fetched it, or Generate ATC did) is never re-queued -
 *    "already has it" is exactly "has bidLinkDoc.fileKey", so this is
 *    naturally a no-op for every bid past its first sync.
 * 2. For any such bid whose Bid Document has since been fetched but not
 *    yet checked for embedded Specification/BOQ Detail Document links,
 *    reads them (extractOrderItemLinks) and fetches+stores those two files
 *    directly - mkp.gem.gov.in serves them with no GeM login at all
 *    (confirmed: a plain curl, no cookies, returns the real file), so this
 *    needs no extension round trip of its own. A bid that already has one
 *    set (a manual upload, or an auto-fetch from an earlier run) is never
 *    overwritten. Marked checked either way so a bid with no such table (a
 *    Regular Bid with no BOQ at all) isn't re-parsed forever.
 */
export async function runAutoDocLinksJobIfDue(db: any): Promise<AutoDocLinksJobResult> {
  const now = new Date();
  const settingsCollection = db.collection(SETTINGS_COLLECTION);
  const settingsDoc = await settingsCollection.findOne({ key: LAST_RUN_KEY });
  if (settingsDoc?.ranAt && now.getTime() - new Date(settingsDoc.ranAt).getTime() < MIN_INTERVAL_MS) {
    return { ran: false, reason: "checked recently" };
  }

  const bidsCollection = db.collection("gem_bids");
  const sections = ["bids_to_fill", "submitted_bids"];

  const toQueue = await bidsCollection
    .find(
      {
        currentSection: { $in: sections },
        "bidLinkDoc.fileKey": { $exists: false },
        "docFetch.status": { $nin: ["pending", "fetching"] },
      },
      { projection: { _id: 1 } }
    )
    .limit(ENQUEUE_BATCH_SIZE)
    .toArray();
  let queuedForFetch = 0;
  if (toQueue.length > 0) {
    const res = await bidsCollection.updateMany(
      { _id: { $in: toQueue.map((b: any) => b._id) } },
      { $set: { docFetch: { status: "pending", requestedAt: now, finishedAt: null, error: null } } }
    );
    queuedForFetch = res.modifiedCount || 0;
  }

  const toExtract = await bidsCollection
    .find(
      {
        currentSection: { $in: sections },
        "bidLinkDoc.fileKey": { $exists: true },
        autoDocLinksCheckedAt: { $exists: false },
      },
      { projection: { _id: 1, bidLinkDoc: 1, boqDetailDoc: 1, specificationDoc: 1 } }
    )
    .limit(EXTRACT_BATCH_SIZE)
    .toArray();

  let extracted = 0;
  for (const bid of toExtract) {
    try {
      const bidDocBytes = await getFileFromR2(bid.bidLinkDoc.fileKey);
      const links = await extractOrderItemLinks(bidDocBytes);
      let found = false;

      if (links.specificationUrl && !bid.specificationDoc?.fileKey) {
        const fetched = await fetchPublicDoc(links.specificationUrl);
        if (fetched) {
          const key = `bids/${bid._id.toString()}/source-docs/spec.pdf`;
          await uploadFileToR2(fetched.buffer, key, "application/pdf");
          await bidsCollection.updateOne(
            { _id: bid._id },
            { $set: { "specificationDoc.fileKey": key, "specificationDoc.fetchedAt": now } }
          );
          found = true;
        }
      }
      if (links.boqUrl && !bid.boqDetailDoc?.fileKey) {
        const fetched = await fetchPublicDoc(links.boqUrl);
        if (fetched) {
          const key = `bids/${bid._id.toString()}/source-docs/boq.csv`;
          await uploadFileToR2(fetched.buffer, key, "text/csv");
          await bidsCollection.updateOne({ _id: bid._id }, { $set: { "boqDetailDoc.fileKey": key, "boqDetailDoc.fetchedAt": now } });
          found = true;
        }
      }

      await bidsCollection.updateOne(
        { _id: bid._id },
        { $set: { autoDocLinksCheckedAt: now, autoDocLinksFound: found } }
      );
      extracted++;
    } catch (err) {
      console.error("autoDocLinksJob: failed for bid", bid._id.toString(), err);
      // Still mark checked - a bid whose Bid Document genuinely can't be
      // parsed (corrupt fetch, etc.) shouldn't be retried every 2 minutes
      // forever; a fresh "Fetch Documents" re-run clears bidLinkDoc's
      // staleness the same way any other re-fetch does.
      await bidsCollection.updateOne({ _id: bid._id }, { $set: { autoDocLinksCheckedAt: now, autoDocLinksFound: false } });
    }
  }

  await settingsCollection.updateOne({ key: LAST_RUN_KEY }, { $set: { key: LAST_RUN_KEY, ranAt: now } }, { upsert: true });

  return { ran: true, queuedForFetch, extracted };
}
