// @/models/Employee.ts
import { Schema, model, models } from "mongoose";

// Attendance has to cover two kinds of people: staff who log into OMS, and
// workers who never touch it. Rather than keeping two separate rosters that
// would drift apart, EVERYONE gets an Employee record here - and the ones who
// also have a login are tied to it by `linkedUsername`.
//
// A plain username string (not an ObjectId ref) because this app has no
// server-side user session and identifies people by username everywhere else
// too - same reasoning as the note at the top of UrgentTask.ts.
const EmployeeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    employeeCode: { type: String, trim: true, default: "" },
    mobile: { type: String, trim: true, default: "" },
    designation: { type: String, trim: true, default: "" },
    joiningDate: { type: Date, default: null },

    // Current monthly salary. Advance/loan balances are deliberately NOT
    // stored here - they are derived by summing EmployeeLedger, so there is
    // one source of truth and a balance can never drift from its entries.
    monthlySalary: { type: Number, default: 0 },

    // Every change to monthlySalary appends here (see PUT /api/employees), so
    // "iski salary pichle saal kitni thi" stays answerable. Kept as a
    // subdocument array rather than its own collection because increments are
    // a handful per person per year - bounded, and always read with the
    // employee anyway.
    salaryHistory: [
      {
        date: { type: String, required: true }, // YYYY-MM-DD
        oldSalary: { type: Number, default: 0 },
        newSalary: { type: Number, required: true },
        note: { type: String, trim: true, default: "" },
        changedBy: { type: String, default: "" },
        _id: false,
      },
    ],

    // Set ONLY for people who also have an OMS login. Left absent (not null)
    // for everyone else, so the partial unique index below simply ignores them.
    linkedUsername: { type: String, trim: true },

    // Never hard-delete somebody who has attendance history - deactivating
    // drops them off today's roster while leaving past months intact.
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// One employee record per OMS login. Partial (not sparse) because a sparse
// unique index still treats an explicit `null` as a value, so several
// unlinked employees would collide with each other.
EmployeeSchema.index(
  { linkedUsername: 1 },
  { unique: true, partialFilterExpression: { linkedUsername: { $type: "string" } } }
);

// The daily roster query: active employees, in name order.
EmployeeSchema.index({ isActive: 1, name: 1 });

export default models.Employee || model("Employee", EmployeeSchema);
