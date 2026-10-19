// @/models/TaskActivity.ts
import { Schema, model, models } from "mongoose";

const TaskActivitySchema = new Schema(
  {
    taskId: { type: String, required: true, index: true },
    by: { type: String, default: null }, // username, null = system
    type: {
      type: String,
      required: true,
      enum: [
        "CREATED", "ASSIGNED", "REASSIGNED", "STATUS_CHANGED", "DUE_CHANGED", "PRIORITY_CHANGED", "EDITED",
        "COMMENT", "FOLLOWUP_ADDED", "CHECKLIST", "ATTACHMENT", "EXTENSION_REQUESTED", "EXTENSION_DECIDED",
        "ESCALATED", "REMINDER_SENT", "REOPENED", "VERIFIED", "REJECTED", "CANCELLED", "DELETED",
      ],
    },
    from: Schema.Types.Mixed,
    to: Schema.Types.Mixed,
    text: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "task_activities" }
);

TaskActivitySchema.index({ taskId: 1, createdAt: -1 });

export default models.TaskActivity || model("TaskActivity", TaskActivitySchema);
