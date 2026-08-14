import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import mongoose from "mongoose";
import Seller from "@/models/Seller";
import SellerOrder from "@/models/SellerOrder";
import MatchFeedbackLog from "@/models/MatchFeedbackLog";
import {
  reinforceOnConfirm,
  learnFromDeductionCorrection,
  learnFromRejection,
} from "@/lib/reconciliation/learningEngine";

async function connectMongoose() {
  await clientPromise;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

async function applyPaymentToBill(billId: string, amount: number, deductionAmount: number, deductionType: string | null, deductionReason: string) {
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

async function reversePaymentFromBill(billId: string, amount: number, deductionAmount: number) {
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

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid match id" }, { status: 400 });
    }

    await connectMongoose();
    const client = await clientPromise;
    const db = client.db();
    const matchesCollection = db.collection("bank_reconciliation_matches");

    const body = await req.json();
    const { action, correctedType, deductionAmount, deductionReason, userName } = body;

    if (!["confirm", "reject", "reverse"].includes(action)) {
      return NextResponse.json({ error: "action must be confirm, reject or reverse" }, { status: 400 });
    }

    const match = await matchesCollection.findOne({ _id: new ObjectId(id) });
    if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });

    // ============================================================
    // CONFIRM
    // ============================================================
    if (action === "confirm") {
      if (match.status !== "pending") {
        return NextResponse.json({ error: "Only a pending match can be confirmed" }, { status: 400 });
      }
      if (!match.sellerId || !match.billIds || match.billIds.length === 0) {
        return NextResponse.json(
          { error: "This transaction has no institute/bill assigned yet — resolve it first" },
          { status: 400 }
        );
      }

      // Reserve the row first (atomic pending -> confirmed) so a concurrent
      // confirm/reject can't double-apply the payment to the underlying bill(s).
      const reserved = await matchesCollection.findOneAndUpdate(
        { _id: match._id, status: "pending" },
        { $set: { status: "confirmed", confirmedAt: new Date(), confirmedBy: userName || "" } }
      );
      if (!reserved) {
        return NextResponse.json({ error: "This match was already processed" }, { status: 409 });
      }

      const finalType = correctedType !== undefined ? correctedType : match.suggestedType;
      const finalDeductionAmount =
        deductionAmount !== undefined ? Number(deductionAmount) : match.deductionAmount || 0;

      if (match.billIds.length === 1) {
        await applyPaymentToBill(
          match.billIds[0],
          match.creditedAmount,
          finalDeductionAmount,
          finalType || null,
          deductionReason ?? match.deductionReason ?? ""
        );
      } else {
        // Combination match: full settlement across several bills, no deduction concept.
        for (const billId of match.billIds) {
          const bill = await SellerOrder.findById(billId);
          if (!bill) continue;
          await applyPaymentToBill(billId, Number(bill.totalAmount || 0) - Number(bill.paidAmount || 0), 0, null, "");
        }
      }

      await matchesCollection.updateOne(
        { _id: match._id },
        { $set: { correctedType: finalType || null, deductionAmount: finalDeductionAmount, deductionReason: deductionReason ?? match.deductionReason ?? "", updatedAt: new Date() } }
      );

      const seller = await Seller.findById(match.sellerId);
      if (seller && match.billIds.length === 1) {
        const feedbackCtx = {
          firmId: match.firmId,
          firmCode: match.firmCode,
          transactionDescription: match.transactionDescription,
          billAmount: match.billAmount,
          creditedAmount: match.creditedAmount,
          deductionAmount: finalDeductionAmount,
          userName,
        };
        if (finalType && match.suggestedType && finalType !== match.suggestedType) {
          await learnFromDeductionCorrection(seller, {
            ...feedbackCtx,
            suggestedType: match.suggestedType,
            correctedType: finalType,
          });
        } else {
          await reinforceOnConfirm(seller, {
            ...feedbackCtx,
            matchedKeyword: match.matchedKeyword,
            deductionType: finalType || null,
          });
        }
      } else if (seller) {
        // Combination match: still reinforce the keyword's confidence, no deduction profile change.
        await reinforceOnConfirm(seller, {
          firmId: match.firmId,
          firmCode: match.firmCode,
          transactionDescription: match.transactionDescription,
          creditedAmount: match.creditedAmount,
          matchedKeyword: match.matchedKeyword,
          deductionType: null,
          userName,
        });
      }

      const updated = await matchesCollection.findOne({ _id: match._id });
      return NextResponse.json(updated);
    }

    // ============================================================
    // REJECT
    // ============================================================
    if (action === "reject") {
      if (match.status !== "pending") {
        return NextResponse.json({ error: "Only a pending match can be rejected" }, { status: 400 });
      }

      const reserved = await matchesCollection.findOneAndUpdate(
        { _id: match._id, status: "pending" },
        { $set: { status: "rejected", updatedAt: new Date() } }
      );
      if (!reserved) {
        return NextResponse.json({ error: "This match was already processed" }, { status: 409 });
      }

      if (match.sellerId) {
        const seller = await Seller.findById(match.sellerId);
        if (seller) {
          await learnFromRejection(seller, {
            firmId: match.firmId,
            firmCode: match.firmCode,
            transactionDescription: match.transactionDescription,
            matchedKeyword: match.matchedKeyword,
            userName,
          });
        }
      } else {
        await MatchFeedbackLog.create({
          firmId: match.firmId,
          firmCode: match.firmCode,
          transactionDescription: match.transactionDescription,
          action: "reject",
          userName,
        });
      }

      const updated = await matchesCollection.findOne({ _id: match._id });
      return NextResponse.json(updated);
    }

    // ============================================================
    // REVERSE (undo a confirmed match)
    // ============================================================
    if (match.status !== "confirmed") {
      return NextResponse.json({ error: "Only a confirmed match can be reversed" }, { status: 400 });
    }

    const reserved = await matchesCollection.findOneAndUpdate(
      { _id: match._id, status: "confirmed" },
      { $set: { status: "pending", updatedAt: new Date() }, $unset: { confirmedAt: "", confirmedBy: "" } }
    );
    if (!reserved) {
      return NextResponse.json({ error: "This match was already processed" }, { status: 409 });
    }

    if (match.billIds && match.billIds.length === 1) {
      await reversePaymentFromBill(match.billIds[0], match.creditedAmount, match.deductionAmount || 0);
    } else if (match.billIds && match.billIds.length > 1) {
      for (const billId of match.billIds) {
        const bill = await SellerOrder.findById(billId);
        if (!bill) continue;
        await reversePaymentFromBill(billId, bill.paidAmount || 0, bill.deductionAmount || 0);
      }
    }

    await MatchFeedbackLog.create({
      firmId: match.firmId,
      firmCode: match.firmCode,
      instituteName: match.instituteName,
      sellerId: match.sellerId,
      transactionDescription: match.transactionDescription,
      billAmount: match.billAmount,
      creditedAmount: match.creditedAmount,
      deductionAmount: match.deductionAmount,
      action: "reverse",
      userName,
    });

    const updated = await matchesCollection.findOne({ _id: match._id });
    return NextResponse.json(updated);
  } catch (error: any) {
    console.error("Reconciliation match PATCH error:", error);
    return NextResponse.json({ error: error.message || "Failed to update match" }, { status: 500 });
  }
}
