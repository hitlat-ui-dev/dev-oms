import mongoose, { Schema, model, models } from "mongoose";

const CompanySchema = new Schema({
  firmName: { type: String, required: true, trim: true },
  firmCode: { type: String, required: true, uppercase: true },
}, { timestamps: true });

export default models.Company || model("Company", CompanySchema);