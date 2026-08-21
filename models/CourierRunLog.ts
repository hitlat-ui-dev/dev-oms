import mongoose, { Schema, Document } from "mongoose";

export interface ICourierMatchedParcel {
  docketNo: string;
  instituteName: string;
  sellerId?: string;
  city: string;
  receiverName: string;
  firmName: string;
  buyerName?: string;
  score: number;
  whatsappNumber?: string;
  // Set at match time, not left to default to PENDING blindly - NO_NUMBER
  // means the institute has no whatsappNumber on file yet, so the bridge
  // should never pick it up (there's nothing to send it to).
  whatsappStatus: "PENDING" | "SENT" | "FAILED" | "NO_NUMBER";
}

export interface ICourierReviewParcel {
  docketNo: string;
  parsedCity: string;
  parsedReceiverName: string;
  bestGuessInstituteName?: string;
  bestGuessSellerId?: string;
  score: number;
  reason: string;
}

export interface ICourierRunLog extends Document {
  date: string; // Format: YYYY-MM-DD
  status: "SUCCESS" | "FAILED" | "IN_PROGRESS";
  totalParcels?: number;
  matchedCount?: number;
  needsReviewCount?: number;
  matched?: ICourierMatchedParcel[];
  needsReview?: ICourierReviewParcel[];
  timestamp: Date;
  error?: string;
  triggeredBy?: string;
}

const CourierMatchedParcelSchema = new Schema<ICourierMatchedParcel>(
  {
    docketNo: { type: String, required: true },
    instituteName: { type: String, required: true },
    sellerId: { type: String },
    city: { type: String },
    receiverName: { type: String },
    firmName: { type: String },
    buyerName: { type: String },
    score: { type: Number, required: true },
    whatsappNumber: { type: String },
    whatsappStatus: { type: String, enum: ["PENDING", "SENT", "FAILED", "NO_NUMBER"], default: "PENDING" },
  },
  { _id: false }
);

const CourierReviewParcelSchema = new Schema<ICourierReviewParcel>(
  {
    docketNo: { type: String, required: true },
    parsedCity: { type: String },
    parsedReceiverName: { type: String },
    bestGuessInstituteName: { type: String },
    bestGuessSellerId: { type: String },
    score: { type: Number, required: true },
    reason: { type: String, required: true },
  },
  { _id: false }
);

const CourierRunLogSchema = new Schema<ICourierRunLog>(
  {
    date: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: ["SUCCESS", "FAILED", "IN_PROGRESS"], required: true },
    totalParcels: { type: Number },
    matchedCount: { type: Number },
    needsReviewCount: { type: Number },
    matched: { type: [CourierMatchedParcelSchema], default: [] },
    needsReview: { type: [CourierReviewParcelSchema], default: [] },
    timestamp: { type: Date, default: Date.now },
    error: { type: String },
    triggeredBy: { type: String, default: "SYSTEM_AUTO" },
  },
  { timestamps: true }
);

export default mongoose.models.CourierRunLog || mongoose.model<ICourierRunLog>("CourierRunLog", CourierRunLogSchema);
