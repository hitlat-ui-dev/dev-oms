import { SUBMITTED_STATUSES } from "./columns";

export interface SubmittedStatusUpdate {
  bidNo: string;
  status: string;
}

/** Shared by the manual status-dropdown route and sync/apply's automated batch. */
export async function applySubmittedStatusUpdates(db: any, updates: SubmittedStatusUpdate[]): Promise<number> {
  if (!updates || updates.length === 0) return 0;
  const bidsCollection = db.collection("gem_bids");
  let updatedCount = 0;
  for (const u of updates) {
    const bidNo = String(u.bidNo || "").trim();
    const status = String(u.status || "").trim();
    if (!bidNo || !(SUBMITTED_STATUSES as readonly string[]).includes(status)) continue;
    const res = await bidsCollection.updateOne(
      { bidNo, currentSection: "submitted_bids" },
      { $set: { submittedStatus: status, updatedAt: new Date() } }
    );
    updatedCount += res.modifiedCount || 0;
  }
  return updatedCount;
}
