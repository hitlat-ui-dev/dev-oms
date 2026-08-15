import SellerOrder from "@/models/SellerOrder";
import { round2 } from "./matchingEngine";

// Shared money-moving primitives used by both the normal confirm/reverse flow
// (app/api/reconciliation/matches/[id]/route.ts) and the correction-alert
// accept flow (app/api/reconciliation/corrections/[id]/route.ts) — kept in one
// place so a correction accept composes the exact same logic a manual confirm
// would use, rather than a parallel implementation.

export async function applyPaymentToBill(
  billId: string,
  amount: number,
  deductionAmount: number,
  deductionType: string | null,
  deductionReason: string
) {
  const bill = await SellerOrder.findById(billId);
  if (!bill) return null;

  const newPaidAmount = round2((bill.paidAmount || 0) + amount);
  const newDeductionAmount = round2((bill.deductionAmount || 0) + deductionAmount);
  const settled = newPaidAmount + newDeductionAmount >= (bill.totalAmount || 0) - 5;

  bill.paidAmount = newPaidAmount;
  bill.deductionAmount = newDeductionAmount;
  if (deductionType) bill.deductionType = deductionType;
  if (deductionReason) bill.deductionReason = deductionReason;
  bill.paymentStatus = settled ? "Paid" : "Partial";
  bill.isPaid = settled;
  await bill.save();
  return bill;
}

export async function reversePaymentFromBill(billId: string, amount: number, deductionAmount: number) {
  const bill = await SellerOrder.findById(billId);
  if (!bill) return null;

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
  await bill.save();
  return bill;
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
