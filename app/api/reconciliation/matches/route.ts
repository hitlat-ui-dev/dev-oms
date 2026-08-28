import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import mongoose from "mongoose";
import dbConnect from "@/lib/dbConnect";
import Seller from "@/models/Seller";
import { txnKey, Transaction } from "@/app/api/account-statements/route";
import {
  findInstituteMatches,
  scoreInstituteCandidates,
  AMBIGUITY_SCORE_MARGIN,
  findOpenBills,
  findAmountMatch,
  findCombinationMatch,
  classifyDeduction,
  isHighConfidenceMatch,
  SellerForMatching,
  InstituteCandidate,
} from "@/lib/reconciliation/matchingEngine";
import { learnFromManualMatch } from "@/lib/reconciliation/learningEngine";
import { buildClusters, findClusterCombinationMatch } from "@/lib/reconciliation/clusterEngine";
import { recheckInstituteGroup } from "@/lib/reconciliation/correctionEngine";

async function connectMongoose() {
  await clientPromise;
  await dbConnect();
}

// generateSuggestions does per-transaction DB round trips (findOpenBills,
// scoreInstituteCandidates, the leftover recheck loop) - it used to run
// automatically inside every GET, which meant just opening the Reconciliation
// page re-ran the whole matching engine over every statement each time. It's
// now only reachable via POST { action: "generate" }, triggered by the
// page's "Run Matching" button.
export const maxDuration = 60;

// Builds (or refreshes, if still pending) a suggested match row for every credited
// transaction across the given statements that doesn't already have a final
// (confirmed/rejected) match on file.
async function generateSuggestions(db: any, statements: any[], firmCode: string | null) {
  const sellers = (await Seller.find({}).lean()) as unknown as SellerForMatching[];
  const sellersById = new Map(sellers.map((s: any) => [String(s._id), s]));

  const existing: any[] = await db
    .collection("bank_reconciliation_matches")
    .find(firmCode ? { firmCode } : {})
    .project({ transactionKey: 1, status: 1, _id: 1, createdAt: 1, rejectedBillIds: 1 })
    .toArray();
  const existingByKey = new Map(existing.map((m: any) => [m.transactionKey, m]));

  const ops: any[] = [];

  for (const statement of statements) {
    const transactions: Transaction[] = statement.transactions || [];
    for (const t of transactions) {
      if (!t.credit || t.credit <= 0) continue;
      const key = `${statement._id}|${txnKey(t)}`;
      const existingMatch = existingByKey.get(key);
      // Confirmed is final - already posted to a bill, never touched again.
      // Rejected is NOT final - re-tried every run (excluding whichever
      // bill(s) were rejected for it before) so a wrong suggestion doesn't
      // permanently strand the transaction with no way to ever match it.
      if (existingMatch && existingMatch.status === "confirmed") continue;
      const rejectedBillIds: string[] = existingMatch?.rejectedBillIds || [];

      // A payer keyword can legitimately belong to more than one institute (shared
      // district-treasury style names, or the same institute paying under a different
      // procurement-mode name). Score every candidate on amount+date fit instead of
      // silently picking the longest keyword match; only ask the user when it's close.
      const candidates = findInstituteMatches(t.description, sellers);
      let instituteMatch: InstituteCandidate | null = null;
      let isAmbiguous = false;
      let ambiguousCandidates: any[] = [];

      if (candidates.length === 1) {
        instituteMatch = candidates[0];
      } else if (candidates.length > 1) {
        const scored = await scoreInstituteCandidates(db, candidates, {
          creditedAmount: t.credit,
          transactionDate: t.date,
          firmCode: statement.firmCode,
        });
        const [top, second] = scored;
        const clearWinner = !second || top.score - second.score > AMBIGUITY_SCORE_MARGIN;
        if (clearWinner) {
          instituteMatch = top;
        } else {
          isAmbiguous = true;
          ambiguousCandidates = scored.slice(0, 3).map((c) => ({
            sellerId: String(c.sellerId),
            instituteName: c.instituteName,
            score: c.score,
            amountFit: c.amountFit,
            dateFit: c.dateFit,
            matchedBillNos: c.matchedBillNos,
          }));
        }
      }

      const seller = instituteMatch ? sellersById.get(String(instituteMatch.sellerId)) : null;

      let billIds: string[] = [];
      let billNos: string[] = [];
      let billAmount = 0;
      let deductionAmount = 0;
      let deductionType: string | null = null;
      let matchTypeForConfidence: "exact" | "deduction" | "combination" | "combination-deduction" | null = null;
      let deductionUsedHistory = false;

      if (instituteMatch) {
        const allOpenBills = await findOpenBills(db, {
          instituteName: instituteMatch.instituteName,
          firmCode: statement.firmCode,
        });
        // Never re-suggest a bill this same transaction's match was already
        // rejected against - the rest of that institute's open bills still
        // matches normally.
        const openBills = rejectedBillIds.length > 0
          ? allOpenBills.filter((b: any) => !rejectedBillIds.includes(String(b._id)))
          : allOpenBills;

        const single = findAmountMatch(openBills, t.credit);
        if (single) {
          billIds = [String(single.bill._id)];
          billNos = [single.bill.orderNo];
          billAmount = single.remainingAmount;
          matchTypeForConfidence = single.matchType;
          if (single.matchType === "deduction") {
            const classification = classifyDeduction(single.remainingAmount, t.credit, seller);
            deductionAmount = single.deductionAmount;
            deductionType = classification.type;
            deductionUsedHistory = classification.usedHistory;
          }
        } else {
          // Cluster-scoped combination matching first — several orders in the same
          // date-burst combining into one payment, deduction (if any) computed once
          // on the combined total — trying the cluster nearest the payment date
          // first; fall back to the whole open-bill pool (old behavior, no deduction)
          // if nothing in any single cluster fits.
          let combo:
            | ReturnType<typeof findClusterCombinationMatch>
            | ReturnType<typeof findCombinationMatch> = null;
          const clusters = buildClusters(openBills as any);
          const txnDate = t.date ? new Date(t.date) : null;
          const txnDateValid = !!txnDate && !isNaN(txnDate.getTime());
          const orderedClusters = txnDateValid
            ? [...clusters].sort((a, b) => {
                const distA = a.endDate ? Math.abs(txnDate!.getTime() - new Date(a.endDate).getTime()) : Infinity;
                const distB = b.endDate ? Math.abs(txnDate!.getTime() - new Date(b.endDate).getTime()) : Infinity;
                return distA - distB;
              })
            : clusters;

          for (const cluster of orderedClusters) {
            combo = findClusterCombinationMatch(cluster.orders, t.credit, seller);
            if (combo) break;
          }
          if (!combo) {
            combo = findCombinationMatch(openBills, t.credit);
          }

          if (combo) {
            billIds = combo.bills.map((b) => String(b._id));
            billNos = combo.bills.map((b) => b.orderNo);
            billAmount = combo.totalAmount;
            matchTypeForConfidence = combo.matchType;
            if ("deductionAmount" in combo && combo.deductionAmount) {
              deductionAmount = combo.deductionAmount;
              deductionType = combo.deductionType;
              deductionUsedHistory = "deductionUsedHistory" in combo ? combo.deductionUsedHistory : false;
            }
          }
        }
      }

      const highConfidence = instituteMatch
        ? isHighConfidenceMatch({
            confidenceLabel: instituteMatch.confidenceLabel,
            matchType: matchTypeForConfidence,
            deductionUsedHistory,
          })
        : false;

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
        isAmbiguous,
        ambiguousCandidates,
        highConfidence,
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

  // Addition 4: leftover-entry-triggered recheck — scoped to a pending payment
  // whose institute is known but which has no valid bill/combo left to match.
  // Only worth checking when that institute already has confirmed history to
  // recheck against, and only once per leftover (skip if already proposed).
  const leftovers = await db
    .collection("bank_reconciliation_matches")
    .find({
      ...(firmCode ? { firmCode } : {}),
      status: "pending",
      sellerId: { $ne: null },
      $or: [{ billIds: { $size: 0 } }, { billIds: { $exists: false } }],
    })
    .toArray();

  for (const leftover of leftovers) {
    const existingAlert = await db.collection("reconciliation_correction_alerts").findOne({
      leftoverMatchId: String(leftover._id),
      status: "pending",
    });
    if (existingAlert) continue;

    const seller = sellersById.get(String(leftover.sellerId)) || null;
    const proposal = await recheckInstituteGroup(db, String(leftover.sellerId), leftover, seller);
    if (proposal) {
      await db.collection("reconciliation_correction_alerts").insertOne({
        ...proposal,
        status: "pending",
        createdAt: new Date(),
      });
    }
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

    // Explicit "Run Matching" trigger - the only place generateSuggestions runs from now.
    if (body.action === "generate") {
      const firmCode = body.firmCode || null;
      const statementFilter: any = {};
      if (firmCode) statementFilter.firmCode = firmCode;
      const statements = await db.collection("account_statements").find(statementFilter).toArray();
      await generateSuggestions(db, statements, firmCode);
      return NextResponse.json({ success: true });
    }

    const { matchId, sellerId, billId, deductionType, deductionAmount, deductionReason } = body;
    if (!matchId || !ObjectId.isValid(matchId) || !sellerId) {
      return NextResponse.json({ error: "matchId and sellerId are required" }, { status: 400 });
    }

    const matchesCollection = db.collection("bank_reconciliation_matches");
    const match = await matchesCollection.findOne({ _id: new ObjectId(matchId) });
    if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });
    // A rejected transaction is allowed here too - rejecting only means "don't
    // suggest that specific wrong bill again," not "never touch this
    // transaction again." Manually pointing it at the correct bill moves it
    // back to pending, same as any fresh suggestion.
    if (match.status !== "pending" && match.status !== "rejected") {
      return NextResponse.json({ error: "Only a pending or rejected match can be reassigned" }, { status: 400 });
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
      status: "pending",
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
