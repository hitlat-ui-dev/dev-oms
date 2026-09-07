import { NextResponse } from "next/server";
import mongoose from "mongoose";
import EmployeeLedger from "@/models/EmployeeLedger";

async function connectMongoose() {
  if (mongoose.connection.readyState !== 1 && process.env.MONGODB_URI) {
    await mongoose.connect(process.env.MONGODB_URI);
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = ["advance", "advance_repay", "loan", "loan_repay"] as const;

// Balances are summed here rather than stored on the Employee, so they can
// never disagree with the entries they come from. One aggregation covers
// everybody - the list view needs all of them at once.
async function balancesByEmployee(employeeId?: string) {
  const match = employeeId ? { employeeId } : {};
  const sumIf = (type: string) => ({ $sum: { $cond: [{ $eq: ["$type", type] }, "$amount", 0] } });

  const rows = await EmployeeLedger.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$employeeId",
        advanceGiven: sumIf("advance"),
        advanceRepaid: sumIf("advance_repay"),
        loanGiven: sumIf("loan"),
        loanRepaid: sumIf("loan_repay"),
      },
    },
  ]);

  return Object.fromEntries(
    rows.map((r: any) => [
      r._id,
      {
        advanceGiven: r.advanceGiven,
        advanceRepaid: r.advanceRepaid,
        advanceBalance: r.advanceGiven - r.advanceRepaid,
        loanGiven: r.loanGiven,
        loanRepaid: r.loanRepaid,
        loanBalance: r.loanGiven - r.loanRepaid,
      },
    ])
  );
}

// GET /api/employee-ledger                    - advance/loan balances for everyone
// GET /api/employee-ledger?employeeId=...     - that person's entries + their balance
export async function GET(req: Request) {
  try {
    await connectMongoose();
    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get("employeeId");

    if (employeeId) {
      const [entries, balances] = await Promise.all([
        EmployeeLedger.find({ employeeId }).sort({ date: -1, createdAt: -1 }).lean(),
        balancesByEmployee(employeeId),
      ]);
      return NextResponse.json({
        entries,
        balance: balances[employeeId] || {
          advanceGiven: 0, advanceRepaid: 0, advanceBalance: 0,
          loanGiven: 0, loanRepaid: 0, loanBalance: 0,
        },
      });
    }

    return NextResponse.json({ balances: await balancesByEmployee() });
  } catch (error: any) {
    console.error("GET employee-ledger error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch ledger" }, { status: 500 });
  }
}

// POST /api/employee-ledger - record one advance/loan movement
export async function POST(req: Request) {
  try {
    await connectMongoose();
    const body = await req.json();

    const employeeId = (body?.employeeId || "").toString();
    const type = (body?.type || "").toString();
    const date = (body?.date || "").toString();
    const amount = Number(body?.amount);

    if (!employeeId) return NextResponse.json({ error: "employeeId is required" }, { status: 400 });
    if (!TYPES.includes(type as any)) {
      return NextResponse.json({ error: `type must be one of ${TYPES.join(", ")}` }, { status: 400 });
    }
    if (!DATE_RE.test(date)) return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    // Zero would be a no-op row and a negative would flip the meaning of the
    // type, so both are rejected rather than quietly stored.
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "amount must be greater than 0" }, { status: 400 });
    }

    const entry = await EmployeeLedger.create({
      employeeId,
      employeeName: (body.employeeName || "").toString(),
      date,
      type,
      amount,
      note: (body.note || "").toString().trim(),
      createdBy: (body.createdBy || "").toString(),
    });

    return NextResponse.json(entry, { status: 201 });
  } catch (error: any) {
    console.error("POST employee-ledger error:", error);
    return NextResponse.json({ error: error.message || "Failed to save entry" }, { status: 500 });
  }
}

// DELETE /api/employee-ledger?id=... - remove a wrongly entered row. A real
// delete, not a flag: a mistyped amount left in place would keep skewing the
// balance, and there is no history worth keeping of an entry that never
// should have existed.
export async function DELETE(req: Request) {
  try {
    await connectMongoose();
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const deleted = await EmployeeLedger.findByIdAndDelete(id);
    if (!deleted) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE employee-ledger error:", error);
    return NextResponse.json({ error: error.message || "Failed to delete entry" }, { status: 500 });
  }
}
