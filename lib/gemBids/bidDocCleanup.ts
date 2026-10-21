import { deleteFileFromR2 } from "@/lib/cloudflareR2";

// Every R2-stored document a bid can accumulate (see fetch-documents/
// upload/route.ts's KIND_FIELD and autoDocLinksJob.ts) - collected here so
// both purge paths (purge-deleted and the expire job's own 7-day purge)
// free the same set rather than each having to remember it independently.
const DOC_FIELDS = ["bidLinkDoc", "boqDetailDoc", "specificationDoc", "bidSpecificAtc"] as const;

/**
 * Deletes every R2 object a batch of about-to-be-purged bids reference,
 * best-effort (a single failed delete is logged and skipped, never thrown -
 * the bid's own DB removal, the actual point of a purge, must not be
 * blocked by a stray R2 error on one leftover file). Call with the full
 * bid documents (not just their _ids) BEFORE the Mongo deleteMany that
 * actually removes them - once that runs, these fileKeys are gone for
 * good with nothing left to free them from.
 */
export async function deleteBidDocumentsFromR2(bids: any[]): Promise<void> {
  const keys = new Set<string>();
  for (const bid of bids) {
    for (const field of DOC_FIELDS) {
      const fileKey = bid[field]?.fileKey;
      if (fileKey) keys.add(fileKey);
    }
  }
  await Promise.all(
    Array.from(keys).map((key) =>
      deleteFileFromR2(key).catch((err) => console.error(`Failed to delete R2 object ${key} during bid purge:`, err))
    )
  );
}

const PROTECTED_DOC_SECTIONS = new Set(["bids_to_fill", "submitted_bids"]);

/**
 * Called from move/route.ts and send-back/route.ts right after a bid's
 * currentSection actually changes - if it's LEAVING Bids to Fill/Submitted
 * Bids (the only two sections the Fill Rates/BOQ Rates workflow ever
 * touches), its fetched documents no longer serve any purpose there and
 * are deleted, by request: "bina kaam ke documents space occupy na kare"
 * (no point in them sitting around once the bid isn't somewhere they're
 * usable). boqRates (the actual rates typed in) is deliberately left
 * alone - that's real work product, not a fetched document, and should
 * still be there if the bid comes back. autoDocLinksCheckedAt/
 * autoDocLinksFound/autoDocLinksRetryCount and docFetch are reset too, so
 * a bid that re-enters one of these two sections later (Send To again)
 * gets a clean fetch attempt instead of silently staying empty forever
 * because it already "looks checked".
 */
export async function clearBidDocsIfLeavingProtectedSections(
  bidsCollection: any,
  bid: any,
  fromSection: string,
  toSection: string
): Promise<void> {
  if (!PROTECTED_DOC_SECTIONS.has(fromSection) || PROTECTED_DOC_SECTIONS.has(toSection)) return;
  await deleteBidDocumentsFromR2([bid]);
  const unset: Record<string, string> = { docFetch: "", autoDocLinksCheckedAt: "", autoDocLinksFound: "", autoDocLinksRetryCount: "" };
  for (const field of DOC_FIELDS) unset[field] = "";
  await bidsCollection.updateOne({ _id: bid._id }, { $unset: unset });
}
