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

    type: {
      type: String,
      enum: ["advance", "advance_repay", "loan", "loan_repay"],
      required: true,
    },

    // Always a positive number. Direction comes from `type`, not from the
    // sign - a negative amount here would make the sums ambiguous.
    amount: { type: Number, required: true, min: 0 },

    note: { type: String, trim: true, default: "" },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

// One employee's statement, newest first.
EmployeeLedgerSchema.index({ employeeId: 1, date: -1 });

export default models.EmployeeLedger || model("EmployeeLedger", EmployeeLedgerSchema);
