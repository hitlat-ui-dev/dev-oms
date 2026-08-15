import mongoose, { Schema, Document } from "mongoose";

// Audit trail for every confirm/edit/reject/manual-match/reverse action taken
// on a bank-reconciliation match — also doubles as the training dataset for
// future refinement of the auto-matching + deduction classification rules.
export interface IMatchFeedbackLog extends Document {
  firmId?: string;
  firmCode?: string;
  instituteName?: string;
  sellerId?: mongoose.Types.ObjectId;
  transactionDescription: string;
  billAmount?: number;
  creditedAmount?: number;
  deductionAmount?: number;
  suggestedType?: string;
  correctedType?: string;
  action: "confirm" | "edit" | "reject" | "manual_match" | "reverse" | "correction_accepted" | "correction_rejected";
  userId?: mongoose.Types.ObjectId;
  userName?: string;
}

const MatchFeedbackLogSchema = new Schema<IMatchFeedbackLog>(
  {
    firmId: { type: String },
    firmCode: { type: String },
    instituteName: { type: String },
    sellerId: { type: Schema.Types.ObjectId, ref: "Seller" },
    transactionDescription: { type: String, required: true },
    billAmount: { type: Number },
    creditedAmount: { type: Number },
    deductionAmount: { type: Number },
    suggestedType: { type: String },
    correctedType: { type: String },
    action: {
      type: String,
      enum: ["confirm", "edit", "reject", "manual_match", "reverse", "correction_accepted", "correction_rejected"],
      required: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    userName: { type: String },
  },
  { timestamps: true }
);

export default mongoose.models.MatchFeedbackLog ||
  mongoose.model<IMatchFeedbackLog>("MatchFeedbackLog", MatchFeedbackLogSchema);
