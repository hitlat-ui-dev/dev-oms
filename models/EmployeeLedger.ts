// @/models/EmployeeLedger.ts
import { Schema, model, models } from "mongoose";

// Money moving between the firm and an employee, one entry per event.
//
// "Advance kitna baki hai" and "loan kitna baki hai" are NOT stored anywhere -
// they are summed from these entries on read. A stored balance and its entries
// can drift apart the first time someone edits one without the other, and with
// money that drift is silent and expensive. Deriving it means the entries are
// always the truth.
//
// Advance and loan are kept as separate types rather than one pot because the
// business treats them differently: an advance is adjusted against the coming
// month's salary, a loan is recovered in installments over many months.
const EmployeeLedgerSchema = new Schema(
  {
    employeeId: { type: String, required: true },

    // Snapshot of the name as it stood when the entry was made - a later
    // rename must not rewrite an old statement.
    employeeName: { type: String, required: true },

    // "YYYY-MM-DD" string for the same reason as Attendance.date: a Date would
    // be stored as UTC midnight and shift a day backwards when read in IST.
    date: { type: String, required: true },

    // "salary" = salary actually paid out (a Debit, like advance/loan given).
    // It never touches the advance/loan balances - only advance_repay and
    // loan_repay do.
    type: {
      type: String,
      enum: ["advance", "advance_repay", "loan", "loan_repay", "salary"],
      required: true,
    },

    // Always a positive number (0 allowed only on a salary row whose whole
    // amount was recovered as advance/loan). Direction comes from `type`, not
    // from the sign - a negative amount here would make the sums ambiguous.
    amount: { type: Number, required: true, min: 0 },

    // ---- Salary approval only ----
    // One approval writes a salary row plus optional advance_repay/loan_repay
    // rows for the recovery; they share an approvalId so an undo removes the
    // whole group and never leaves a half-applied one behind.
    approvalId: { type: String, default: "" },
    // "YYYY-MM" the salary is for (not the payment date).
    forMonth: { type: String, default: "" },
    // What the attendance formula produced at approval time, kept next to the
    // (possibly hand-edited) approved figure so a manual change stays visible.
    calculatedAmount: { type: Number, default: 0 },
    // Approved salary before advance/loan recovery. Cash paid = finalSalary
    // minus the recovery rows, and is stored in `amount`.
    finalSalary: { type: Number, default: 0 },

    note: { type: String, trim: true, default: "" },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

// One employee's statement, newest first.
EmployeeLedgerSchema.index({ employeeId: 1, date: -1 });

export default models.EmployeeLedger || model("EmployeeLedger", EmployeeLedgerSchema);
