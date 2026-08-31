import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

export interface Transaction {
  sno: string;
  date: string;
  description: string;
  debit: number;
  credit: number;
  chequeNo: string;
  balance: number;
}

interface Gap {
  afterDate: string;
  afterDescription: string;
  afterBalance: number;
  beforeDate: string;
  beforeDescription: string;
  beforeBalance: number;
  expectedBalance: number;
  difference: number;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// A transaction is "the same" as one already on file if date + description + debit +
// credit + running balance all match — the running balance makes this effectively unique.
// Exported so the reconciliation module can fingerprint the same transaction consistently.
export const txnKey = (t: Transaction) =>
  `${t.date}|${t.description.trim().toLowerCase()}|${round2(t.debit)}|${round2(t.credit)}|${round2(t.balance)}`;

// Converts a date string into a YYYYMMDD number so transactions sort
// chronologically regardless of which format the source bank used - plain
// string comparison only happens to work for YYYY-MM-DD (Mehsana); banks
// that print DD/MM/YY (HDFC) sort by day-of-month first under a raw string
// compare, which silently scrambles the order.
const parseDateForSort = (dateStr: string): number => {
  const s = dateStr.trim();
  let m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/); // YYYY-MM-DD
  if (m) return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/); // DD-MM-YYYY
  if (m) return Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]);
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})$/); // DD-MM-YY
  if (m) return (2000 + Number(m[3])) * 10000 + Number(m[2]) * 100 + Number(m[1]);
  return 0;
};

// Sort by date, then by numeric S.No (when present) as a tiebreaker for same-day entries.
const sortTransactions = (list: Transaction[]) =>
  [...list].sort((a, b) => {
    const dateCompare = parseDateForSort(a.date) - parseDateForSort(b.date);
    if (dateCompare !== 0) return dateCompare;
    const snoA = parseInt(a.sno, 10);
    const snoB = parseInt(b.sno, 10);
    if (!isNaN(snoA) && !isNaN(snoB)) return snoA - snoB;
    return 0;
  });

// Walk the continuous running-balance chain and flag any point where a transaction's
// balance doesn't follow from the previous one — that means entries are missing in between.
const detectGaps = (sorted: Transaction[], openingBalance: number): Gap[] => {
  const gaps: Gap[] = [];
  let prevBalance = openingBalance;
  let prevDate = "";
  let prevDescription = "Opening Balance";

  for (const t of sorted) {
    const expected = round2(prevBalance - t.debit + t.credit);
    const actual = round2(t.balance);
    if (Math.abs(expected - actual) > 0.01) {
      gaps.push({
        afterDate: prevDate,
        afterDescription: prevDescription,
        afterBalance: prevBalance,
        beforeDate: t.date,
        beforeDescription: t.description,
        beforeBalance: actual,
        expectedBalance: expected,
        difference: round2(actual - expected),
      });
    }
    prevBalance = t.balance;
    prevDate = t.date;
    prevDescription = t.description;
  }
  return gaps;
};

// GET: list all firms' merged statement ledgers (most recently updated first)
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db();
    const statements = await db
      .collection("account_statements")
      .find({})
      .sort({ updatedAt: -1 })
      .toArray();
    return NextResponse.json(statements);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch statements" }, { status: 500 });
  }
}

// POST: merge a newly parsed statement upload into that firm's ongoing ledger —
// only genuinely new transactions are added, duplicates are skipped, and any
// break in the running-balance chain is reported back as a gap warning.
export async function POST(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db();
    const body = await req.json();

    if (!body.firmId || !Array.isArray(body.transactions)) {
      return NextResponse.json({ error: "firmId and transactions are required" }, { status: 400 });
    }

    const incoming: Transaction[] = body.transactions;
    const collection = db.collection("account_statements");
    // A firm can hold multiple bank accounts — each account number under a
    // firm gets its own ledger, so two different accounts never get merged together.
    const accountNumber = body.accountNumber || "";
    const existing = await collection.findOne({ firmId: body.firmId, accountNumber });

    const uploadEvent = {
      fileName: body.fileName || "",
      uploadedBy: body.uploadedBy || "",
      uploadedAt: new Date(),
      periodFrom: body.statementPeriodFrom || "",
      periodTo: body.statementPeriodTo || "",
    };

    if (!existing) {
      const sorted = sortTransactions(incoming);
      const openingBalance = Number(body.openingBalance) || 0;
      const gaps = detectGaps(sorted, openingBalance);
      const doc = {
        firmId: body.firmId,
        firmCode: body.firmCode || "",
        firmName: body.firmName || "",
        bankName: body.bankName || "",
        accountHolderName: body.accountHolderName || "",
        accountNumber: body.accountNumber || "",
        ifscCode: body.ifscCode || "",
        openingBalance,
        closingBalance: sorted.length > 0 ? sorted[sorted.length - 1].balance : openingBalance,
        totalDebit: round2(sorted.reduce((s, t) => s + t.debit, 0)),
        totalCredit: round2(sorted.reduce((s, t) => s + t.credit, 0)),
        transactions: sorted,
        gaps,
        uploadHistory: [{ ...uploadEvent, addedCount: sorted.length, duplicateCount: 0 }],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const result = await collection.insertOne(doc);
      return NextResponse.json(
        { statement: { _id: result.insertedId, ...doc }, addedCount: sorted.length, duplicateCount: 0, gaps },
        { status: 201 }
      );
    }

    // Merge: keep every existing transaction, add only the ones not already on file
    const existingKeys = new Set((existing.transactions as Transaction[]).map(txnKey));
    const newOnes = incoming.filter((t) => !existingKeys.has(txnKey(t)));
    const duplicateCount = incoming.length - newOnes.length;

    const merged = sortTransactions([...(existing.transactions as Transaction[]), ...newOnes]);
    const gaps = detectGaps(merged, Number(existing.openingBalance) || 0);

    const updatedDoc = {
      // Bank/account identity fields refresh to the latest upload's values when present
      bankName: body.bankName || existing.bankName || "",
      accountHolderName: body.accountHolderName || existing.accountHolderName || "",
      accountNumber: body.accountNumber || existing.accountNumber || "",
      ifscCode: body.ifscCode || existing.ifscCode || "",
      closingBalance: merged.length > 0 ? merged[merged.length - 1].balance : existing.openingBalance,
      totalDebit: round2(merged.reduce((s, t) => s + t.debit, 0)),
      totalCredit: round2(merged.reduce((s, t) => s + t.credit, 0)),
      transactions: merged,
      gaps,
      uploadHistory: [...(existing.uploadHistory || []), { ...uploadEvent, addedCount: newOnes.length, duplicateCount }],
      updatedAt: new Date(),
    };

    await collection.updateOne({ _id: existing._id }, { $set: updatedDoc });
    const finalDoc = { ...existing, ...updatedDoc };

    return NextResponse.json({ statement: finalDoc, addedCount: newOnes.length, duplicateCount, gaps });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to save statement" }, { status: 500 });
  }
}

// DELETE: remove a firm's whole statement ledger by id (?id=...), or just one
// transaction line within it (?id=...&txnKey=...) - a wrongly-included or
// duplicate row from a bad upload. Removing a line shifts the running-balance
// chain, so closing balance / totals / gaps are recomputed the same way a
// fresh save would, rather than just splicing the array.
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const txnKeyParam = searchParams.get("txnKey");
    if (!id || !ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Valid id is required" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();
    const collection = db.collection("account_statements");

    if (!txnKeyParam) {
      await collection.deleteOne({ _id: new ObjectId(id) });
      return NextResponse.json({ success: true });
    }

    const existing = await collection.findOne({ _id: new ObjectId(id) });
    if (!existing) {
      return NextResponse.json({ error: "Statement not found" }, { status: 404 });
    }

    const remaining = (existing.transactions as Transaction[]).filter((t) => txnKey(t) !== txnKeyParam);
    if (remaining.length === existing.transactions.length) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    const sorted = sortTransactions(remaining);
    const gaps = detectGaps(sorted, Number(existing.openingBalance) || 0);
    const updatedDoc = {
      closingBalance: sorted.length > 0 ? sorted[sorted.length - 1].balance : existing.openingBalance,
      totalDebit: round2(sorted.reduce((s, t) => s + t.debit, 0)),
      totalCredit: round2(sorted.reduce((s, t) => s + t.credit, 0)),
      transactions: sorted,
      gaps,
      updatedAt: new Date(),
    };
    await collection.updateOne({ _id: new ObjectId(id) }, { $set: updatedDoc });

    return NextResponse.json({ statement: { ...existing, ...updatedDoc } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to delete" }, { status: 500 });
  }
}
