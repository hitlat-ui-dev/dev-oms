import mongoose, { Schema, model, models } from "mongoose";

const ItemSchema = new Schema({
  itemName: { type: String, required: true },
  category: { type: String, required: true },
  currentStock: { type: Number, default: 0 }, // Automatically managed by purchases/sales
}, { timestamps: true });

const Item = models.Item || model("Item", ItemSchema);
export default Item;