import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import mongoose from "mongoose";
import MatchFeedbackLog from "@/models/MatchFeedbackLog";
import { applyPaymentToBill, reversePaymentFromBill, applyComboPayment } from "@/lib/reconciliation/paymentEngine";

async function connectMongoose() {
  await clientPromise;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// PATCH: resolve a leftover-entry correction alert (Addition 4). Never fires on
// its own — a human always chooses accept ("yes, revert and apply the
// correction") or reject ("no, keep the original match as-is") first.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid correction alert id" }, { status: 400 });
    }

    await connectMongoose();
    const client = await clientPromise;
    const db = client.db();
    const alertsCollection = db.collection("reconciliation_correction_alerts");
    const matchesCollection = db.collection("bank_reconciliation_matches");

    const body = await req.json();
    const { action, userName } = body;
    if (!["accept", "reject"].includes(action)) {
      return NextResponse.json({ error: "action must be accept or reject" }, { status: 400 });
    }

    const alert = await alertsCollection.findOne({ _id: new ObjectId(id) });
    if (!alert) return NextResponse.json({ error: "Correction alert not found" }, { status: 404 });
    if (alert.status !== "pending") {
      return NextResponse.json({ error: "This correction alert was already resolved" }, { status: 409 });
    }

    // Reserve first so a concurrent accept/reject can't double-apply.
    const reserved = await alertsCollection.findOneAndUpdate(
      { _id: alert._id, status: "pending" },
      { $set: { status: action === "accept" ? "accepted" : "rejected", resolvedAt: new Date(), resolvedBy: userName || "" } }
    );
    if (!reserved) {
      return NextResponse.json({ error: "This correction alert was already resolved" }, { status: 409 });
    }

    if (action === "reject") {
      await MatchFeedbackLog.create({
        firmId: alert.firmId,
        firmCode: alert.firmCode,
        instituteName: alert.instituteName,
        sellerId: alert.sellerId,
        transactionDescription: `Correction alert rejected — kept original match. ${alert.reason}`,
        action: "correction_rejected",
        userName,
      });
      return NextResponse.json({ status: "rejected" });
    }

    // ACCEPT: reverse the suspect's original (single-bill) payment, then re-apply
    // both payments against the suggested (swapped) bill assignment.
    const suspectMatch = await matchesCollection.findOne({ _id: new ObjectId(alert.suspectMatchId) });
    const leftoverMatch = await matchesCollection.findOne({ _id: new ObjectId(alert.leftoverMatchId) });
    if (!suspectMatch || !leftoverMatch) {
      // Roll the reservation back — nothing was applied, so this alert is still resolvable.
      await alertsCollection.updateOne({ _id: alert._id }, { $set: { status: "pending" }, $unset: { resolvedAt: "", resolvedBy: "" } });
      return NextResponse.json({ error: "One of the matches referenced by this alert no longer exists" }, { status: 409 });
    }
    if (suspectMatch.status !== "confirmed" || leftoverMatch.status !== "pending") {
      await alertsCollection.updateOne({ _id: alert._id }, { $set: { status: "pending" }, $unset: { resolvedAt: "", resolvedBy: "" } });
      return NextResponse.json(
        { error: "The matches referenced by this alert have changed state since it was raised — refresh and re-check." },
        { status: 409 }
      );
    }

    await reversePaymentFromBill(suspectMatch.billIds[0], suspectMatch.creditedAmount, suspectMatch.deductionAmount || 0);

    const newSuspectBillId: string = alert.suggestedReassignment.suspectMatchNewBillIds[0];
    const newSuspectBill = await applyPaymentToBill(
      newSuspectBillId,
      suspectMatch.creditedAmount,
      suspectMatch.deductionAmount || 0,
      suspectMatch.correctedType || suspectMatch.deductionType || null,
      suspectMatch.deductionReason || ""
    );

    const newLeftoverBillIds: string[] = alert.suggestedReassignment.leftoverMatchNewBillIds;
    let newLeftoverBills: any[] = [];
    if (newLeftoverBillIds.length === 1) {
      const bill = await applyPaymentToBill(newLeftoverBillIds[0], leftoverMatch.creditedAmount, 0, null, "");
      if (bill) newLeftoverBills = [bill];
    } else {
      const result = await applyComboPayment(newLeftoverBillIds, leftoverMatch.creditedAmount, 0, null, "");
      newLeftoverBills = result.bills;
    }

    await matchesCollection.updateOne(
      { _id: suspectMatch._id },
      {
        $set: {
          billIds: [newSuspectBillId],
          billNos: newSuspectBill ? [newSuspectBill.orderNo] : suspectMatch.billNos,
          updatedAt: new Date(),
        },
      }
    );
    await matchesCollection.updateOne(
      { _id: leftoverMatch._id },
      {
        $set: {
          billIds: newLeftoverBillIds,
          billNos: newLeftoverBills.map((b) => b.orderNo),
          billAmount: round2(newLeftoverBills.reduce((s, b) => s + Number(b.totalAmount || 0), 0)),
          status: "confirmed",
          confirmedAt: new Date(),
          confirmedBy: userName || "",
          updatedAt: new Date(),
        },
      }
    );

    await MatchFeedbackLog.create({
      firmId: alert.firmId,
      firmCode: alert.firmCode,
      instituteName: alert.instituteName,
      sellerId: alert.sellerId,
      transactionDescription: `Correction alert accepted — swapped bill assignment. ${alert.reason}`,
      action: "correction_accepted",
      userName,
    });

    return NextResponse.json({ status: "accepted" });
  } catch (error: any) {
    console.error("Correction alert PATCH error:", error);
    return NextResponse.json({ error: error.message || "Failed to resolve correction alert" }, { status: 500 });
  }
}
