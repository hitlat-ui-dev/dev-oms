import mongoose, { Schema, Document } from "mongoose";

export interface IBackupLog extends Document {
  date: string; // Format: YYYY-MM-DD
  status: "SUCCESS" | "FAILED" | "IN_PROGRESS";
  fileName?: string;
  fileId?: string;
  fileSize?: number;
  collectionsCount?: number;
  recordsCount?: number;
  timestamp: Date;
  error?: string;
  triggeredBy?: string;
}

const BackupLogSchema = new Schema<IBackupLog>(
  {
    date: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: ["SUCCESS", "FAILED", "IN_PROGRESS"], required: true },
    fileName: { type: String },
    fileId: { type: String },
    fileSize: { type: Number },
    collectionsCount: { type: Number },
    recordsCount: { type: Number },
    timestamp: { type: Date, default: Date.now },
    error: { type: String },
    triggeredBy: { type: String, default: "SYSTEM_AUTO" },
  },
  { timestamps: true }
);

export default mongoose.models.BackupLog || mongoose.model<IBackupLog>("BackupLog", BackupLogSchema);
