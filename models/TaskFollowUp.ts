// @/models/TaskFollowUp.ts
// Schema only in Phase 1; the follow-up API and UI arrive in Phase 2.
import { Schema, model, models } from "mongoose";

const TaskFollowUpSchema = new Schema(
  {
    taskId: { type: String, required: true, index: true },
    by: { type: String, required: true },
    at: { type: Date, default: Date.now },
    mode: { type: String, enum: ["CALL", "WHATSAPP", "EMAIL", "VISIT", "GEM_PORTAL", "INTERNAL"], required: true },
    contactPerson: String,
    note: { type: String, required: true, maxlength: 2000 },
    outcome: { type: String, enum: ["POSITIVE", "NO_RESPONSE", "PROMISED", "NEGATIVE", "RESOLVED"], required: true },
    promisedDate: Date,
    nextFollowUpAt: Date,
  },
  { timestamps: true, collection: "task_followups" }
);

export default models.TaskFollowUp || model("TaskFollowUp", TaskFollowUpSchema);
