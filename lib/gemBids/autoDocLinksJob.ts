import { ObjectId } from "mongodb";
import { getFileFromR2, uploadFileToR2 } from "@/lib/cloudflareR2";
import { extractOrderItemLinks } from "@/lib/documentMaker/linkExtractEngine";

const SETTINGS_COLLECTION = "gem_bid_settings";
const LAST_RUN_KEY = "lastAutoDocLinksJobDate";
const MIN_INTERVAL_MS = 2 * 60 * 1000;
const EXTRACT_BATCH_SIZE = 5;

export interface AutoDocLinksJobResult {
  ran: boolean;
  reason?: string;
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

// POST /api/gem-bids/fetch-documents/bulk — queues a Bid Document fetch
// (docFetch, same mechanism the Generate ATC button already uses) for
// exactly the bids the user selected in Bids to Fill/Submitted Bids and
// clicked "Fetch Documents" for. Deliberately NOT automatic for every bid
// in those sections (an earlier version of this feature was, and was
// reverted by request - GeM blocks non-browser requests for the Bid
// Document itself, so this always costs a real extension round trip per
// bid; only fetching what was actually asked for keeps that bounded to
// what the user is actually working on right now).
export async function enqueueDocFetchForBids(db: any, bidIds: string[]): Promise<{ queuedCount: number }> {
  const objectIds = bidIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  if (objectIds.length === 0) return { queuedCount: 0 };

  const now = new Date();
  const result = await db.collection("gem_bids").updateMany(
    { _id: { $in: objectIds }, "docFetch.status": { $nin: ["pending", "fetching"] } },
    { $set: { docFetch: { status: "pending", requestedAt: now, finishedAt: null, error: null } } }
  );
  return { queuedCount: result.modifiedCount || 0 };
}

/**
 * Self-throttled, site-visit-triggered (see app/layout.tsx), same pattern
 * as runExpireBidsJobIfDue. For any Bids to Fill/Submitted Bids bid whose
 * Bid Document has already been fetched (manually via "Fetch Documents",
 * see enqueueDocFetchForBids above, or Generate ATC) but not yet checked
 * for embedded Specification/BOQ Detail Document links, reads them
 * (extractOrderItemLinks) and fetches+stores those two files directly -
 * mkp.gem.gov.in serves them with no GeM login at all (confirmed: a plain
 * curl, no cookies, returns the real file), so this needs no extension
 * round trip of its own. A bid that already has one set (a manual upload)
 * is never overwritten. Marked checked either way so a bid with no such
 * table (a Regular Bid with no BOQ at all) isn't re-parsed forever.
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

  return { ran: true, extracted };
}
