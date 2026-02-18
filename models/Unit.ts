import mongoose, { Schema, model, models } from "mongoose";

const UnitSchema = new Schema({
  name: { type: String, required: true, unique: true, trim: true }
}, { timestamps: true });

export default models.Unit || model("Unit", UnitSchema);