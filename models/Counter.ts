// @/models/Counter.ts
// Shares the existing `counters` collection (orders already keeps
// { _id: "orderId", seq } there). Task numbers use _id "task-YYMM".
import { Schema, model, models } from "mongoose";

const CounterSchema = new Schema(
  { _id: { type: String }, seq: { type: Number, default: 0 } },
  { collection: "counters" }
);

export default models.Counter || model("Counter", CounterSchema);
