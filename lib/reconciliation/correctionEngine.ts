import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { findAmountMatch, SellerForMatching } from "./matchingEngine";
import { findClusterCombinationMatch } from "./clusterEngine";

const MAX_CONFIRMED_TO_CONSIDER = 10;

const ELIGIBLE_BILL_STATUSES = ["TO CHECK", "READY TO SHIP", "DELIVERY", "FULFILLED", "HISAB"];

export interface CorrectionProposal {
  firmId?: string;
  firmCode?: string;
  sellerId: string;
  instituteName: string;
  leftoverMatchId: string;
  suspectMatchId: string;
  reason: string;
  suggestedReassignment: {
    suspectMatchNewBillIds: string[];
    leftoverMatchNewBillIds: string[];
  };
}

/**
 * Addition 4 — a narrow, event-triggered recheck. Only runs when a specific
 * leftover pending payment for an institute has nothing left to match, which
 * can mean an earlier CONFIRMED payment in that same institute's group actually
 * settled the "wrong" bill (freeing up the bill this leftover payment needed).
 * Bounded to the institute's most recent confirmed single-bill matches — never
 * auto-applies, only proposes a swap for a human to accept/reject.
 *
 * Scoped to single-bill suspects on purpose: a combo (multi-bill) confirmed
 * match already spread its payment proportionally across several bills, and
 * cleanly "un-spreading" just one of them to free it up for the leftover isn't
 * a well-defined operation — those cases are left for manual review instead.
 */
export async function recheckInstituteGroup(
  db: Db,
  sellerId: string,
  leftoverMatch: any,
  seller: SellerForMatching | null
): Promise<CorrectionProposal | null> {
  const matchesCollection = db.collection("bank_reconciliation_matches");
  const ordersCollection = db.collection("sellerorders");

  const confirmed = await matchesCollection
    .find({ sellerId, status: "confirmed" })
    .sort({ confirmedAt: -1 })
    .limit(MAX_CONFIRMED_TO_CONSIDER)
    .toArray();
  if (confirmed.length === 0) return null;

  for (const suspect of confirmed) {
    if (!suspect.billIds || suspect.billIds.length !== 1) continue;
    const suspectBill = await ordersCollection.findOne({ _id: new ObjectId(suspect.billIds[0]) });
    if (!suspectBill) continue;

    // Simulate reverting this one payment: roll paidAmount back by what this
    // suspect match contributed, so findAmountMatch/findClusterCombinationMatch
    // (which derive remainingAmount from totalAmount - paidAmount) see the bill
    // as it stood immediately before this match was confirmed.
    const revertedPaidAmount = Math.max(0, Number(suspectBill.paidAmount || 0) - Number(suspect.creditedAmount || 0));
    if (Number(suspectBill.totalAmount || 0) - revertedPaidAmount <= 0) continue;
    const revertedBill = { ...suspectBill, paidAmount: revertedPaidAmount };

    const otherOpenBills = await ordersCollection
      .find({
        instituteName: leftoverMatch.instituteName,
        isPaid: { $ne: true },
        status: { $in: ELIGIBLE_BILL_STATUSES },
        _id: { $ne: suspectBill._id },
      })
      .toArray();
    const pool = [revertedBill, ...otherOpenBills];

    const leftoverSingle = findAmountMatch(pool, leftoverMatch.creditedAmount);
    const leftoverCombo = leftoverSingle ? null : findClusterCombinationMatch(pool, leftoverMatch.creditedAmount, seller);
    if (!leftoverSingle && !leftoverCombo) continue;

    const leftoverBillIds = leftoverSingle
      ? [String(leftoverSingle.bill._id)]
      : leftoverCombo!.bills.map((b: any) => String(b._id));

    // The suspect's own payment must still find a home among what's left over
    // (almost always just the other open bills, since the leftover claimed the
    // reverted one in the common case where it's the reverted bill itself).
    const remainingPoolForSuspect = pool.filter((b: any) => !leftoverBillIds.includes(String(b._id)));
    const suspectReassignment = findAmountMatch(remainingPoolForSuspect, suspect.creditedAmount);
    if (!suspectReassignment) continue;

    return {
      firmId: leftoverMatch.firmId,
      firmCode: leftoverMatch.firmCode,
      sellerId,
      instituteName: leftoverMatch.instituteName,
      leftoverMatchId: String(leftoverMatch._id),
      suspectMatchId: String(suspect._id),
      reason:
        `Payment on ${suspect.transactionDate} (₹${suspect.creditedAmount}) was confirmed against ` +
        `${suspectBill.orderNo}, leaving the ${leftoverMatch.transactionDate} payment (₹${leftoverMatch.creditedAmount}) ` +
        `with nothing left to match. Swapping which bill each payment settles satisfies both.`,
      suggestedReassignment: {
        suspectMatchNewBillIds: [String(suspectReassignment.bill._id)],
        leftoverMatchNewBillIds: leftoverBillIds,
      },
    };
  }

  return null;
}
