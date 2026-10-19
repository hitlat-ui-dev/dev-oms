// @/models/TaskSettings.ts
// Single document (_id "default"). Schema only in Phase 1; read in P3,
// editable in P5.
import { Schema, model, models } from "mongoose";

const TaskSettingsSchema = new Schema(
  {
    _id: { type: String, default: "default" },
    workStartHour: { type: Number, default: 10 },
    workEndHour: { type: Number, default: 19 },
    workingDays: { type: [Number], default: [1, 2, 3, 4, 5, 6] },
    dailyDigestTime: { type: String, default: "09:45" },
    eveningSummaryTime: { type: String, default: "18:30" },
    escalateToManagerAfterHours: { type: Number, default: 4 },
    escalateToAdminAfterHours: { type: Number, default: 24 },
    pauseSlaWhenWaiting: { type: Boolean, default: false },
    whatsappEnabled: { type: Boolean, default: true },
    whatsappMaxPerMinute: { type: Number, default: 8 },
    holidays: { type: [Date], default: [] },
  },
  { collection: "task_settings" }
);

export default models.TaskSettings || model("TaskSettings", TaskSettingsSchema);
