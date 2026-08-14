import mongoose, { Schema, model, models } from "mongoose";

const CompanySchema = new Schema({
  firmName: { type: String, required: true, trim: true },
  firmCode: { type: String, required: true, uppercase: true },
  sellerRegisterAddress: { type: String, required: false, trim: true },
  // Separate from sellerRegisterAddress (which serves a different purpose) -
  // this is the dispatch/return address printed on shipping labels.
  dispatchAddress: { type: String, required: false, trim: true },
  mobile: { type: String, required: false, trim: true },
}, { timestamps: true });

export default models.Company || model("Company", CompanySchema);