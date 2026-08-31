import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";
import DDEntry from "@/models/DDEntry";
import { parseTxnDate, computeTxnKey } from "@/lib/ddMatching";

async function connectMongoose() {
  await clientPromise;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

// POST /api/dd-entries/:id/confirm-match — { statementId, txnKey, date, userName? }
// Confirms one bank-statement transaction line as this DD's refund credit.
// The only path that can set status -> refund_credited.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    await connectMongoose();
    const client = await clientPromise;
    const db = client.db();

    const body = await req.json();
    const { statementId, txnKey, date } = body;
    if (!statementId || !ObjectId.isValid(statementId) || !txnKey) {
      return NextResponse.json({ error: "statementId and txnKey are required" }, { status: 400 });
    }

    const entry = await DDEntry.findById(id);
    if (!entry) return NextResponse.json({ error: "DD entry not found" }, { status: 404 });
    if (entry.status !== "returned_cancelled") {
      return NextResponse.json(
        { error: `DD must be in "returned_cancelled" status to confirm a refund match (currently "${entry.status}").` },
        { status: 400 }
      );
    }

    // Guard against the same statement line being claimed by two DDs (a race,
    // or the user confirming a stale candidate list).
    const alreadyUsed = await DDEntry.findOne({ _id: { $ne: id }, matchedStatementId: statementId, matchedTxnKey: txnKey });
    if (alreadyUsed) {
      return NextResponse.json({ error: "This bank entry is already matched to another DD." }, { status: 409 });
    }

    const statement = await db.collection("account_statements").findOne({ _id: new ObjectId(statementId) });
    if (!statement) return NextResponse.json({ error: "Bank statement not found" }, { status: 404 });
    const txnExists = (statement.transactions || []).some((t: any) => computeTxnKey(t) === txnKey);
    if (!txnExists) {
      return NextResponse.json({ error: "That transaction line was not found in this statement." }, { status: 404 });
    }

    entry.status = "refund_credited";
    entry.matchedStatementId = new mongoose.Types.ObjectId(statementId);
    entry.matchedTxnKey = txnKey;
    // The candidate's own bank-statement date (passed through from
    // /match-candidates) — falls back to today only if the client omitted it.
    entry.refundCreditDate = date ? parseTxnDate(date) : new Date();
    await entry.save();

    return NextResponse.json(entry);
  } catch (error: any) {
    console.error("DD confirm-match POST error:", error);
    return NextResponse.json({ error: error.message || "Failed to confirm match" }, { status: 500 });
  }
}
