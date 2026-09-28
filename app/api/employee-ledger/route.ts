import { NextResponse } from "next/server";
import mongoose from "mongoose";
import EmployeeLedger from "@/models/EmployeeLedger";

async function connectMongoose() {
  if (mongoose.connection.readyState !== 1 && process.env.MONGODB_URI) {
    await mongoose.connect(process.env.MONGODB_URI);
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
// "salary" is deliberately absent: it can only be written through the
// approve_salary action below, which keeps its recovery rows in step.
const TYPES = ["advance", "advance_repay", "loan", "loan_repay"] as const;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// POST ?action=approve_salary - approve one employee's salary for a month:
// writes the Salary Di row, plus advance_repay / loan_repay rows for whatever
// is being recovered out of it, all under one approvalId.
async function approveSalary(body: any) {
  const employeeId = (body?.employeeId || "").toString();
  const forMonth = (body?.forMonth || "").toString();
  const date = (body?.date || "").toString();
  const finalSalary = round2(Number(body?.finalSalary));
  const calculatedAmount = round2(Number(body?.calculatedAmount) || 0);
  const advanceDeduct = round2(Number(body?.advanceDeduct) || 0);
  const loanDeduct = round2(Number(body?.loanDeduct) || 0);

  if (!employeeId) return NextResponse.json({ error: "employeeId is required" }, { status: 400 });
  if (!MONTH_RE.test(forMonth)) return NextResponse.json({ error: "forMonth must be YYYY-MM" }, { status: 400 });
  if (!DATE_RE.test(date)) return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  if (!Number.isFinite(finalSalary) || finalSalary < 0) {
    return NextResponse.json({ error: "finalSalary must be 0 or more" }, { status: 400 });
  }
  if (advanceDeduct < 0 || loanDeduct < 0) {
    return NextResponse.json({ error: "Deductions cannot be negative" }, { status: 400 });
  }
  if (advanceDeduct + loanDeduct > finalSalary) {
    return NextResponse.json({ error: "Advance + loan katauti salary se zyada nahi ho sakti" }, { status: 400 });
  }

  // One salary per employee per month - a second approval would pay twice.
  const already = await EmployeeLedger.findOne({ employeeId, type: "salary", forMonth }).lean();
  if (already) {
    return NextResponse.json({ error: `${forMonth} ki salary pehle se approve ho chuki hai` }, { status: 409 });
  }

  // Recovery can't exceed what is actually outstanding.
  const bal = (await balancesByEmployee(employeeId))[employeeId] || { advanceBalance: 0, loanBalance: 0 };
  if (advanceDeduct > bal.advanceBalance + 0.001) {
    return NextResponse.json({ error: `Advance baki sirf ${bal.advanceBalance} hai` }, { status: 400 });
  }
  if (loanDeduct > bal.loanBalance + 0.001) {
    return NextResponse.json({ error: `Loan baki sirf ${bal.loanBalance} hai` }, { status: 400 });
  }

  const approvalId = new mongoose.Types.ObjectId().toString();
  const base = {
    employeeId,
    employeeName: (body.employeeName || "").toString(),
    date,
    forMonth,
    approvalId,
    createdBy: (body.createdBy || "").toString(),
  };
  const noteText = (body.note || "").toString().trim();
  const rows: any[] = [
    {
      ...base,
      type: "salary",
      amount: round2(finalSalary - advanceDeduct - loanDeduct),
      calculatedAmount,
      finalSalary,
      note: noteText || `Salary ${forMonth}`,
    },
  ];
  if (advanceDeduct > 0) {
    rows.push({ ...base, type: "advance_repay", amount: advanceDeduct, note: `Salary ${forMonth} se kata` });
  }
  if (loanDeduct > 0) {
    rows.push({ ...base, type: "loan_repay", amount: loanDeduct, note: `Salary ${forMonth} se kata` });
  }

  try {
    const created = await EmployeeLedger.insertMany(rows);
    return NextResponse.json({ approvalId, entries: created }, { status: 201 });
  } catch (err) {
    // Not a transaction - if any row failed, clear the group so no half-applied approval is left.
    await EmployeeLedger.deleteMany({ approvalId });
    throw err;
  }
}

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

    // Salary rows for one month, everybody - the Monthly View uses this to
    // show who is already approved.
    const forMonth = searchParams.get("forMonth");
    if (forMonth) {
      if (!MONTH_RE.test(forMonth)) return NextResponse.json({ error: "forMonth must be YYYY-MM" }, { status: 400 });
      const salaries = await EmployeeLedger.find({ type: "salary", forMonth }).lean();
      return NextResponse.json({ salaries });
    }

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

    if (new URL(req.url).searchParams.get("action") === "approve_salary") {
      return await approveSalary(body);
    }

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

    const entry = await EmployeeLedger.findById(id).lean();
    if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

    // A row born from a salary approval goes together with its siblings -
    // removing only the salary row (or only a recovery row) would leave the
    // balances and the paid amount disagreeing.
    const approvalId = (entry as any).approvalId;
    if (approvalId) {
      const result = await EmployeeLedger.deleteMany({ approvalId });
      return NextResponse.json({ success: true, removed: result.deletedCount });
    }

    await EmployeeLedger.findByIdAndDelete(id);
    return NextResponse.json({ success: true, removed: 1 });
  } catch (error: any) {
    console.error("DELETE employee-ledger error:", error);
    return NextResponse.json({ error: error.message || "Failed to delete entry" }, { status: 500 });
  }
}
