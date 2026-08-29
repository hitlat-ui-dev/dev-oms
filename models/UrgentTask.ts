// @/models/UrgentTask.ts
import mongoose, { Schema, model, models } from "mongoose";

// This app has no separate Staff/User Mongoose model or server-side auth
// session - every team member is identified by their plain `username` string
// (see app/api/login/route.ts, and localStorage's "oms_user"), so
// assignedTo/assignedBy are usernames here too, not ObjectId refs.
const UrgentTaskSchema = new Schema(
  {
    description: { type: String, required: true, trim: true },
    assignedTo: { type: String, required: true },
    assignedBy: { type: String, required: true },
    status: { type: String, enum: ["pending", "snoozed", "done"], default: "pending" },
    snoozeUntil: { type: Date, default: null },
    doneAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Powers both the assignee's "do I have anything due right now" poll and the
// owner dashboard's "everything still open" list.
UrgentTaskSchema.index({ assignedTo: 1, status: 1 });
UrgentTaskSchema.index({ status: 1, createdAt: 1 });

export default models.UrgentTask || model("UrgentTask", UrgentTaskSchema);
