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
