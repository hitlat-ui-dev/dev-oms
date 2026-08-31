import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";
import DDEntry from "@/models/DDEntry";
import { findMatchCandidates } from "@/lib/ddMatching";

async function connectMongoose() {
  await clientPromise;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

// GET /api/dd-entries/:id/match-candidates
// Bank-refund match candidates for a returned_cancelled DD, drawn from the
// account_statements ledger of the firm's mapped bank account, ranked by
// score (DD number / payee name / amount match).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    await connectMongoose();
    const client = await clientPromise;
    const db = client.db();

    const entry = await DDEntry.findById(id).populate("firmBankAccount").lean<any>();
    if (!entry) return NextResponse.json({ error: "DD entry not found" }, { status: 404 });
    if (entry.status !== "returned_cancelled") {
      return NextResponse.json(
        { error: `DD must be in "returned_cancelled" status before it can be matched (currently "${entry.status}").` },
        { status: 400 }
      );
    }
    if (!entry.firmBankAccount?.accountNumber) {
      return NextResponse.json({ error: "This DD's firm bank account has no account number on file." }, { status: 400 });
    }

    const statements = await db
      .collection("account_statements")
      .find({ accountNumber: entry.firmBankAccount.accountNumber })
      .toArray();

    if (statements.length === 0) {
      return NextResponse.json({ candidates: [], note: "No bank statement uploaded yet for this firm's mapped account." });
    }

    // A bank-statement line can only ever refund one DD - exclude lines
    // already claimed by another DD entry's confirmed match.
    const alreadyMatched = await DDEntry.find({ _id: { $ne: id }, matchedTxnKey: { $ne: null } })
      .select("matchedStatementId matchedTxnKey")
      .lean<any[]>();
    const excludeByStatement = new Map<string, Set<string>>();
    for (const m of alreadyMatched) {
      const sid = String(m.matchedStatementId);
      if (!excludeByStatement.has(sid)) excludeByStatement.set(sid, new Set());
      excludeByStatement.get(sid)!.add(m.matchedTxnKey);
    }

    const allCandidates: any[] = [];
    for (const stmt of statements) {
      const exclude = excludeByStatement.get(String(stmt._id)) || new Set<string>();
      const candidates = findMatchCandidates(stmt.transactions || [], entry, exclude);
      for (const c of candidates) {
        allCandidates.push({ ...c, statementId: stmt._id, bankName: stmt.bankName, accountNumber: stmt.accountNumber });
      }
    }
    allCandidates.sort((a, b) => b.score - a.score);

    return NextResponse.json({ candidates: allCandidates });
  } catch (error: any) {
    console.error("DD match-candidates GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to load match candidates" }, { status: 500 });
  }
}
