import Counter from "@/models/Counter";
import { istYYMM } from "./ist";

/** TSK-YYMM-0001 - atomic per-month sequence stored in `counters` as "task-YYMM" (IST month). */
export async function generateTaskNo(now: Date = new Date()): Promise<string> {
  const yymm = istYYMM(now);

  const counter = await Counter.findOneAndUpdate(
    { _id: `task-${yymm}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return `TSK-${yymm}-${String(counter.seq).padStart(4, "0")}`;
}
