import mongoose, { Schema, model, models } from "mongoose";

const VendorSchema = new Schema({
  name: { type: String, required: true, trim: true },
  place: { type: String, required: true },
  address: { type: String, required: true },
  mobile: { type: String, required: true },
}, { timestamps: true });

export default models.Vendor || model("Vendor", VendorSchema);