import mongoose, { Schema, model, models } from "mongoose";

const SellerSchema = new Schema({
  instituteName: { type: String, required: true, trim: true },
  buyerName: { type: String, required: true, trim: true },
  mobile: { type: String, required: true },
  address: { type: String, required: true },
  place: { type: String, required: true },
}, { timestamps: true });

export default models.Seller || model("Seller", SellerSchema);