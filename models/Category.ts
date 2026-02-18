import mongoose, { Schema, model, models } from "mongoose";

const CategorySchema = new Schema({
  name: { type: String, required: true, unique: true, trim: true }
}, { timestamps: true });

export default models.Category || model("Category", CategorySchema);