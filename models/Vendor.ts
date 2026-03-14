import mongoose, { Schema, model, models } from "mongoose";

const VendorSchema = new Schema({
  name: { type: String, required: true, trim: true },
  place: { type: String, required: true },
  address: { type: String, required: false},
  mobile: { type: String , required: false},
}, { timestamps: true });

export default models.Vendor || model("Vendor", VendorSchema);