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
import { applyPaymentToBill, reversePaymentFromBill, applyComboPayment } from "@/lib/reconciliation/paymentEngine";

async function connectMongoose() {
  await clientPromise;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

// Detail drawer for a single match: the credited transaction itself plus the
// full line-item detail (item name, qty, rate, total) for every bill it's
// matched against - a combo match resolves to more than one SellerOrder here.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid match id" }, { status: 400 });
    }

    await connectMongoose();
    const client = await clientPromise;
    const db = client.db();

    const match = await db.collection("bank_reconciliation_matches").findOne({ _id: new ObjectId(id) });
    if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });

    const billIds: string[] = (match.billIds || []).filter((bid: string) => ObjectId.isValid(bid));
    const bills = billIds.length
      ? await db
          .collection("sellerorders")
          .find({ _id: { $in: billIds.map((bid) => new ObjectId(bid)) } })
          .project({
            orderNo: 1,
            itemName: 1,
            reQty: 1,
            unit: 1,
            rate: 1,
            totalAmount: 1,
            paidAmount: 1,
            contractDate: 1,
            contractNo: 1,
          })
          .toArray()
      : [];

    return NextResponse.json({ match, bills });
  } catch (error: any) {
    console.error("Reconciliation match GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to load match detail" }, { status: 500 });
  }
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
      if (!match.sellerId) {
        return NextResponse.json(
          { error: "This transaction has no institute assigned yet — resolve it first" },
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

      // Populated only for a combo (multi-bill) confirm, so the cluster-pattern
      // learning hook below can record the gap between the orders it settled.
      let comboOrderDates: string[] = [];

      if (!match.billIds || match.billIds.length === 0) {
        // Link-only confirm - the credit is now attributed to this institute,
        // but there's no specific bill to post the payment against (e.g. an
        // advance/unallocated credit). Nothing to apply, just record it.
      } else if (match.billIds.length === 1) {
        await applyPaymentToBill(
          match.billIds[0],
          match.creditedAmount,
          finalDeductionAmount,
          finalType || null,
          deductionReason ?? match.deductionReason ?? ""
        );
      } else {
        // Combination match: distribute the credited amount + any classified deduction
        // proportionally across the bills by their remaining-amount share, so a
        // cluster-combo-with-deduction match settles each bill correctly instead of
        // silently absorbing the deduction as if the full remaining amount was paid.
        const result = await applyComboPayment(
          match.billIds,
          match.creditedAmount,
          finalDeductionAmount,
          finalType || null,
          deductionReason ?? match.deductionReason ?? ""
        );
        comboOrderDates = result.contractDates;
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
        // Combination match: reinforce the keyword's confidence, the deduction profile
        // (now that combos can carry one), and the cluster/gap pattern from the orders
        // this payment settled together.
        await reinforceOnConfirm(seller, {
          firmId: match.firmId,
          firmCode: match.firmCode,
          transactionDescription: match.transactionDescription,
          billAmount: match.billAmount,
          creditedAmount: match.creditedAmount,
          deductionAmount: finalDeductionAmount,
          matchedKeyword: match.matchedKeyword,
          deductionType: finalDeductionAmount > 0 ? finalType || null : null,
          clusterOrderDates: comboOrderDates,
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

      // Records which bill(s) this specific suggestion pointed at, so the next
      // "Run Matching" pass can rule those bills out for THIS transaction and
      // try again, instead of either re-suggesting the exact same wrong match
      // or abandoning the transaction entirely (previously rejected meant
      // "final" - never reconsidered, never manually reassignable).
      const reserved = await matchesCollection.findOneAndUpdate(
        { _id: match._id, status: "pending" },
        {
          $set: { status: "rejected", updatedAt: new Date() },
          $addToSet: { rejectedBillIds: { $each: match.billIds || [] } },
        }
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
