// @/models/Task.ts
import { Schema, model, models } from "mongoose";

// Users are referenced by plain `username` string everywhere (same as
// UrgentTask) - the app has no ObjectId-based user model for sessions.
const ChecklistItem = new Schema(
  {
    text: { type: String, required: true, maxlength: 300 },
    done: { type: Boolean, default: false },
    doneBy: String,
    doneAt: Date,
  },
  { _id: true }
);

const TaskSchema = new Schema(
  {
    taskNo: { type: String, unique: true, required: true },
    title: { type: String, required: true, maxlength: 200, trim: true },
    description: { type: String, maxlength: 5000, default: "" },

    category: {
      type: String,
      enum: ["ORDER", "DELIVERY", "BILLING", "PAYMENT_FOLLOWUP", "BID", "GEM_CATALOGUE", "DOCUMENT", "PURCHASE", "ACCOUNTS", "GENERAL"],
      default: "GENERAL",
    },
    priority: { type: String, enum: ["LOW", "NORMAL", "HIGH", "URGENT"], default: "NORMAL" },
    status: { type: String, enum: ["OPEN", "IN_PROGRESS", "WAITING", "DONE", "CLOSED", "CANCELLED"], default: "OPEN" },

    firm: { type: String, default: "" },

    // Plain ids + display strings, no refs.
    links: {
      sellerOrderId: String,
      gemOrderNo: String,
      bidId: String,
      bidNo: String,
      billId: String,
      billNo: String,
      buyerName: String,
      buyerPhone: String,
    },

    assignedBy: { type: String, required: true },
    assignee: { type: String, required: true },
    watchers: { type: [String], default: [] },

    dueAt: { type: Date, required: true },
    startedAt: Date,
    completedAt: Date,
    closedAt: Date,
    closedBy: String,

    requiresVerification: { type: Boolean, default: true },
    waitingOn: { type: String, enum: ["BUYER", "STAFF", "MATERIAL", "PAYMENT", "OTHER", null], default: null },
    nextFollowUpAt: Date,
    followUpCount: { type: Number, default: 0 },

    checklist: { type: [ChecklistItem], default: [] },

    // Kept now, used in later phases (no migration later).
    attachments: [{ name: String, r2Key: String, size: Number, mime: String, uploadedBy: String, uploadedAt: Date }],
    recurrence: {
      enabled: { type: Boolean, default: false },
      rule: { type: String, enum: ["DAILY", "WEEKLY", "MONTHLY", null], default: null },
      weekdays: [Number],
      dayOfMonth: Number,
      parentTaskId: String,
      nextRunAt: Date,
    },
    extensionRequest: {
      requestedDueAt: Date,
      reason: String,
      status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED", null], default: null },
      requestedAt: Date,
      decidedBy: String,
    },
    escalationLevel: { type: Number, default: 0 },
    lastReminderAt: Date,

    tags: { type: [String], default: [] },
    isDeleted: { type: Boolean, default: false },
    source: {
      type: String,
      enum: ["WEB", "WHATSAPP", "RECURRING", "MIGRATED_TODO", "MIGRATED_URGENT", "AUTO"],
      default: "WEB",
    },
  },
  { timestamps: true, collection: "tasks" }
);

TaskSchema.index({ assignee: 1, status: 1, dueAt: 1 });
TaskSchema.index({ assignedBy: 1, status: 1 });
TaskSchema.index({ status: 1, nextFollowUpAt: 1 });
TaskSchema.index({ isDeleted: 1, dueAt: 1 });
TaskSchema.index({ "links.sellerOrderId": 1 });
TaskSchema.index({ "links.bidId": 1 });
TaskSchema.index({ "links.billId": 1 });
TaskSchema.index({ title: "text", description: "text", "links.buyerName": "text", "links.gemOrderNo": "text" });

export default models.Task || model("Task", TaskSchema);
