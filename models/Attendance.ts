// @/models/Attendance.ts
import { Schema, model, models } from "mongoose";

// One document per employee per calendar day.
//
// `date` is a "YYYY-MM-DD" STRING, deliberately not a Date. A Date would be
// stored as UTC midnight, and every read/write from IST (UTC+5:30) risks
// landing on the previous calendar day - the classic attendance off-by-one
// where the 1st of the month quietly becomes the 30th. A plain string is also
// exactly what a register means: a calendar date, with no timezone attached.
// It sorts and range-compares correctly too, since the format is fixed-width.
const AttendanceSchema = new Schema(
  {
    employeeId: { type: String, required: true },

    // Snapshot of the name as it stood the day this was marked. An employee
    // renamed (or deactivated) later must not silently rewrite old registers.
    employeeName: { type: String, required: true },

    date: { type: String, required: true },

    status: {
      type: String,
      enum: ["present", "absent", "half_day", "leave", "holiday"],
      required: true,
    },

    inTime: { type: String, default: "" }, // "HH:MM", 24-hour
    outTime: { type: String, default: "" },
    overtimeHours: { type: Number, default: 0 },
    note: { type: String, trim: true, default: "" },

    markedBy: { type: String, default: "" }, // username of whoever saved it
    markedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// One record per person per day - the API's upsert depends on this being
// unique, so a re-save edits the day instead of adding a second row.
AttendanceSchema.index({ employeeId: 1, date: 1 }, { unique: true });

// The monthly view reads a whole date range in one query.
AttendanceSchema.index({ date: 1 });

export default models.Attendance || model("Attendance", AttendanceSchema);
