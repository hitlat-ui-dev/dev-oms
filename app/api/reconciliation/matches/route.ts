import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import mongoose from "mongoose";
import Seller from "@/models/Seller";
import { txnKey, Transaction } from "@/app/api/account-statements/route";
import {
  findInstituteMatch,
  findOpenBills,
  findAmountMatch,
  findCombinationMatch,
  classifyDeduction,
  SellerForMatching,
} from "@/lib/reconciliation/matchingEngine";
import { learnFromManualMatch } from "@/lib/reconciliation/learningEngine";

async function connectMongoose() {
  await clientPromise;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

// Builds (or refreshes, if still pending) a suggested match row for every credited
// transaction across the given statements that doesn't already have a final
// (confirmed/rejected) match on file.
async function generateSuggestions(db: any, statements: any[], firmCode: string | null) {
  const sellers = (await Seller.find({}).lean()) as unknown as SellerForMatching[];
  const sellersById = new Map(sellers.map((s: any) => [String(s._id), s]));

  const existing: any[] = await db
    .collection("bank_reconciliation_matches")
    .find(firmCode ? { firmCode } : {})
    .project({ transactionKey: 1, status: 1, _id: 1, createdAt: 1 })
    .toArray();
  const existingByKey = new Map(existing.map((m: any) => [m.transactionKey, m]));

  const ops: any[] = [];

  for (const statement of statements) {
    const transactions: Transaction[] = statement.transactions || [];
    for (const t of transactions) {
      if (!t.credit || t.credit <= 0) continue;
      const key = `${statement._id}|${txnKey(t)}`;
      const existingMatch = existingByKey.get(key);
      if (existingMatch && existingMatch.status !== "pending") continue; // final, don't touch

      const instituteMatch = findInstituteMatch(t.description, sellers);
      const seller = instituteMatch ? sellersById.get(String(instituteMatch.sellerId)) : null;

      let billIds: string[] = [];
      let billNos: string[] = [];
      let billAmount = 0;
      let deductionAmount = 0;
      let deductionType: string | null = null;

      if (instituteMatch) {
        const openBills = await findOpenBills(db, {
          instituteName: instituteMatch.instituteName,
          firmCode: statement.firmCode,
        });

        const single = findAmountMatch(openBills, t.credit);
        if (single) {
          billIds = [String(single.bill._id)];
          billNos = [single.bill.orderNo];
          billAmount = single.remainingAmount;
          if (single.matchType === "deduction") {
            const classification = classifyDeduction(single.remainingAmount, t.credit, seller);
            deductionAmount = single.deductionAmount;
            deductionType = classification.type;
          }
        } else {
          const combo = findCombinationMatch(openBills, t.credit);
          if (combo) {
            billIds = combo.bills.map((b) => String(b._id));
            billNos = combo.bills.map((b) => b.orderNo);
            billAmount = combo.totalAmount;
          }
        }
      }

      const doc = {
        firmId: statement.firmId,
        firmCode: statement.firmCode,
        statementId: String(statement._id),
        transactionKey: key,
        transactionDate: t.date,
        transactionDescription: t.description,
        creditedAmount: t.credit,
        instituteName: instituteMatch?.instituteName || null,
        sellerId: instituteMatch?.sellerId ? String(instituteMatch.sellerId) : null,
        billIds,
        billNos,
        billAmount,
        deductionAmount,
        deductionType,
        deductionReason: "",
        matchedKeyword: instituteMatch?.matchedKeyword || null,
        confidence: instituteMatch?.confidence ?? 0,
        confidenceLabel: instituteMatch?.confidenceLabel || "new",
        status: "pending",
        suggestedType: deductionType,
        correctedType: null,
        updatedAt: new Date(),
      };

      if (existingMatch) {
        ops.push({
          updateOne: {
            filter: { _id: existingMatch._id },
            update: { $set: doc },
          },
        });
      } else {
        ops.push({
          insertOne: { document: { ...doc, createdAt: new Date() } },
        });
      }
    }
  }

  if (ops.length > 0) {
    await db.collection("bank_reconciliation_matches").bulkWrite(ops);
  }
}

export async function GET(req: Request) {
  try {
    await connectMongoose();
    const client = await clientPromise;
    const db = client.db();

    const { searchParams } = new URL(req.url);
    const firmCode = searchParams.get("firmCode");
    const status = searchParams.get("status");
    const instituteName = searchParams.get("instituteName");

    const statementFilter: any = {};
    if (firmCode) statementFilter.firmCode = firmCode;

    const shouldGenerate = !status || status === "pending";
    if (shouldGenerate) {
      const statements = await db.collection("account_statements").find(statementFilter).toArray();
      await generateSuggestions(db, statements, firmCode);
    }

    const matchFilter: any = {};
    if (firmCode) matchFilter.firmCode = firmCode;
    if (status) matchFilter.status = status;
    if (instituteName) matchFilter.instituteName = instituteName;

    const matches = await db
      .collection("bank_reconciliation_matches")
      .find(matchFilter)
      .sort({ transactionDate: -1 })
      .toArray();

    return NextResponse.json(matches);
  } catch (error: any) {
    console.error("Reconciliation matches GET error:", error);
    return NextResponse.json({ error: error.message || "Failed to load matches" }, { status: 500 });
  }
}

// Manually resolve an unmatched (or mis-suggested) transaction to an institute + bill.
// Learns a new keyword alias for the institute when it had no matched keyword before,
// but still leaves the row in "pending" status — the user must Confirm separately
// before anything is posted to the ledger.
export async function POST(req: Request) {
  try {
    await connectMongoose();
    const client = await clientPromise;
    const db = client.db();
    const body = await req.json();

    const { matchId, sellerId, billId, deductionType, deductionAmount, deductionReason } = body;
    if (!matchId || !ObjectId.isValid(matchId) || !sellerId) {
      return NextResponse.json({ error: "matchId and sellerId are required" }, { status: 400 });
    }

    const matchesCollection = db.collection("bank_reconciliation_matches");
    const match = await matchesCollection.findOne({ _id: new ObjectId(matchId) });
    if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });
    if (match.status !== "pending") {
      return NextResponse.json({ error: "Only a pending match can be reassigned" }, { status: 400 });
    }

    const seller = await Seller.findById(sellerId);
    if (!seller) return NextResponse.json({ error: "Institute not found" }, { status: 404 });

    if (!match.matchedKeyword) {
      await learnFromManualMatch(seller, {
        firmId: match.firmId,
        firmCode: match.firmCode,
        transactionDescription: match.transactionDescription,
        creditedAmount: match.creditedAmount,
        userName: body.userName,
      });
    }

    let billIds: string[] = [];
    let billNos: string[] = [];
    let billAmount = 0;
    let resolvedDeductionAmount = Number(deductionAmount) || 0;
    let resolvedDeductionType = deductionType || null;

    if (billId && ObjectId.isValid(billId)) {
      const bill = await db.collection("sellerorders").findOne({ _id: new ObjectId(billId) });
      if (bill) {
        const remaining = Number(bill.totalAmount || 0) - Number(bill.paidAmount || 0);
        billIds = [String(bill._id)];
        billNos = [bill.orderNo];
        billAmount = remaining;
        if (!deductionType && !deductionAmount) {
          const classification = classifyDeduction(remaining, match.creditedAmount, seller.toObject());
          resolvedDeductionAmount = remaining - match.creditedAmount > 0 ? remaining - match.creditedAmount : 0;
          resolvedDeductionType = classification.type;
        }
      }
    }

    const update = {
      instituteName: seller.instituteName,
      sellerId: String(seller._id),
      billIds,
      billNos,
      billAmount,
      deductionAmount: resolvedDeductionAmount,
      deductionType: resolvedDeductionType,
      deductionReason: deductionReason || "",
      suggestedType: resolvedDeductionType,
      updatedAt: new Date(),
    };

    await matchesCollection.updateOne({ _id: match._id }, { $set: update });
    const updated = await matchesCollection.findOne({ _id: match._id });
    return NextResponse.json(updated);
  } catch (error: any) {
    console.error("Reconciliation matches POST error:", error);
    return NextResponse.json({ error: error.message || "Failed to save manual match" }, { status: 500 });
  }
}
