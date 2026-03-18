import mongoose, { Schema, model, models } from "mongoose";

const ItemSchema = new Schema({
  itemName: { type: String, required: true, trim: true },
  sku: { type: String, required: true, unique: true },
  category: { type: String, required: true },
  unit: { type: String, required: true },
  currentStock: { type: Number, default: 0 },
  location: { type: String, required: false, default: "" }
}, { timestamps: true });

export default models.Item || model("Item", ItemSchema);