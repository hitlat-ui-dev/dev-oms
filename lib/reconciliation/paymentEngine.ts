import SellerOrder from "@/models/SellerOrder";
import { round2 } from "./matchingEngine";

// Shared money-moving primitives used by both the normal confirm/reverse flow
// (app/api/reconciliation/matches/[id]/route.ts) and the correction-alert
// accept flow (app/api/reconciliation/corrections/[id]/route.ts) — kept in one
// place so a correction accept composes the exact same logic a manual confirm
// would use, rather than a parallel implementation.

// A bulk confirm/reject can fire several requests concurrently (see the same
// issue on the Seller side in learningEngine.ts's saveSellerWithRetry), and
// two of them touching the same bill - a combo match that happens to share a
// member with another pending match - would otherwise have the second
// save() fail outright with a Mongoose VersionError. Re-fetches the bill
// fresh on each attempt (not a stale pre-loaded instance) so a retried
// mutation always computes its paidAmount/deductionAmount delta on top of
// whatever the other concurrent request already saved, rather than
// clobbering it.
async function saveBillWithRetry(billId: string, mutate: (bill: any) => void, maxAttempts = 5): Promise<any> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const bill = await SellerOrder.findById(billId);
    if (!bill) return null;
    mutate(bill);
    try {
      await bill.save();
      return bill;
    } catch (err: any) {
      if (err?.name !== "VersionError" || attempt === maxAttempts - 1) throw err;
    }
  }
  return null;
}

export async function applyPaymentToBill(
  billId: string,
  amount: number,
  deductionAmount: number,
  deductionType: string | null,
  deductionReason: string
) {
  return saveBillWithRetry(billId, (bill) => {
    const newPaidAmount = round2((bill.paidAmount || 0) + amount);
    const newDeductionAmount = round2((bill.deductionAmount || 0) + deductionAmount);
    const totalAmount = bill.totalAmount || 0;

    // A confirm should never be able to push a bill past its own total - this
    // is the only thing standing between "two pending matches both suggested
    // the same bill" (a real, confirmed scenario: several identical-amount
    // open bills all getting suggested the same one until a fresh Run
    // Matching pass catches up) and silently quadruple-paying one bill while
    // its siblings stay unpaid forever.
    if (newPaidAmount + newDeductionAmount > totalAmount + 5) {
      throw new Error(
        `Bill ${bill.orderNo || billId} would be overpaid: ₹${newPaidAmount + newDeductionAmount} against a ₹${totalAmount} total. It's likely already settled by another payment - re-run Matching and confirm the correct bill.`
      );
    }

    const settled = newPaidAmount + newDeductionAmount >= totalAmount - 5;

    bill.paidAmount = newPaidAmount;
    bill.deductionAmount = newDeductionAmount;
    if (deductionType) bill.deductionType = deductionType;
    if (deductionReason) bill.deductionReason = deductionReason;
    bill.paymentStatus = settled ? "Paid" : "Partial";
    bill.isPaid = settled;
  });
}

export async function reversePaymentFromBill(billId: string, amount: number, deductionAmount: number) {
  return saveBillWithRetry(billId, (bill) => {
    const newPaidAmount = Math.max(0, round2((bill.paidAmount || 0) - amount));
    const newDeductionAmount = Math.max(0, round2((bill.deductionAmount || 0) - deductionAmount));
    const settled = newPaidAmount + newDeductionAmount >= (bill.totalAmount || 0) - 5;

    bill.paidAmount = newPaidAmount;
    bill.deductionAmount = newDeductionAmount;
    bill.paymentStatus = newPaidAmount + newDeductionAmount <= 0 ? "Pending" : settled ? "Paid" : "Partial";
    bill.isPaid = settled && newPaidAmount + newDeductionAmount > 0;
    if (bill.paymentStatus === "Pending") {
      bill.deductionType = null;
      bill.deductionReason = "";
    }
  });
}

/**
 * Applies one combined payment across several bills, splitting the credited
 * amount + any classified deduction proportionally by each bill's remaining-
 * amount share — a cluster-combo match settles several orders from one payment
 * (Addition 1), and the deduction is computed once on the combined total, never
 * re-derived per bill. Returns the underlying bill docs (pre-update contractDate
 * etc.) for callers that also need them, e.g. cluster-pattern learning.
 */
export async function applyComboPayment(
  billIds: string[],
  creditedAmount: number,
  deductionAmount: number,
  deductionType: string | null,
  deductionReason: string
) {
  const bills: any[] = [];
  for (const billId of billIds) {
    const bill = await SellerOrder.findById(billId);
    if (bill) bills.push(bill);
  }
  const contractDates: string[] = bills.map((b) => b.contractDate).filter(Boolean);

  const totalRemaining = bills.reduce(
    (s, b) => s + (Number(b.totalAmount || 0) - Number(b.paidAmount || 0)),
    0
  );
  const updatedBills = [];
  for (const bill of bills) {
    const billRemaining = Number(bill.totalAmount || 0) - Number(bill.paidAmount || 0);
    const share = totalRemaining > 0 ? billRemaining / totalRemaining : 0;
    const updated = await applyPaymentToBill(
      String(bill._id),
      round2(creditedAmount * share),
      round2(deductionAmount * share),
      deductionType,
      deductionReason
    );
    if (updated) updatedBills.push(updated);
  }
  return { bills: updatedBills, contractDates };
}
