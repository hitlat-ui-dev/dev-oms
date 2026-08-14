import mongoose, { Schema, model, models } from "mongoose";

const SellerSchema = new Schema({
  instituteName: { 
    type: String, 
    required: true, 
    trim: true 
    // uppercase: true removed
  },
  buyerName: { 
    type: String, 
    required: false, 
    trim: true 
  },
  mobile: { 
    type: String, 
    required: false 
  },
  address: { 
    type: String, 
    required: false 
  },
  place: { 
    type: String, 
    required: false, 
    trim: true 
  },
  sellerBillName: {
    type: String,
    required: false,
    trim: true
  },
  // Exact/near-exact copy of the "Location" text GeM shows on an order
  // (e.g. "Govt. industrial training institute, deodar, opp. mamlatdar
  // office, ta - deodar, di - banaskantha") - used to auto-match a fetched
  // GeM order's raw location string back to this Institute.
  gemLocationText: {
    type: String,
    required: false,
    trim: true
  },
  statementDescriptionName: [{
    type: String,
    trim: true
  }],
  // Self-learning matching: confidence/source tracking per keyword in statementDescriptionName
  aliasMeta: [{
    keyword: { type: String, required: true },
    confidence: { type: Number, default: 1 },
    lastUsed: { type: Date, default: Date.now },
    source: {
      type: String,
      enum: ["manual_seed", "learned"],
      default: "manual_seed",
    },
  }],
  // Keywords that were confirmed NOT to belong to this institute (past rejections)
  negativeKeywords: [{
    keyword: { type: String, required: true },
    rejectedCount: { type: Number, default: 1 },
  }],
  // Learned distribution of past deduction types for this institute, used to
  // prioritize the auto-suggested deduction type before falling back to the
  // default 2%/4% percentage rule
  deductionProfile: {
    tdsOnlyCount: { type: Number, default: 0 },
    tdsGstCount: { type: Number, default: 0 },
    kasarCount: { type: Number, default: 0 },
    kasarRange: {
      min: { type: Number, default: null },
      max: { type: Number, default: null },
    },
    lastConfirmedType: { type: String, default: null },
  },
  // If true, high-confidence auto-suggested matches for this institute can be
  // auto-confirmed instead of always requiring manual review
  autoApproveTrusted: { type: Boolean, default: false },
}, { timestamps: true });

export default models.Seller || model("Seller", SellerSchema);