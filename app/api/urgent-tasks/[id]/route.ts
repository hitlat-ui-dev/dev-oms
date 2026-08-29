import { NextResponse } from "next/server";
import mongoose from "mongoose";
import UrgentTask from "@/models/UrgentTask";

async function connectMongoose() {
  if (mongoose.connection.readyState !== 1 && process.env.MONGODB_URI) {
    await mongoose.connect(process.env.MONGODB_URI);
  }
}

const SNOOZE_MS = 10 * 60 * 1000; // 10 minutes

// PATCH /api/urgent-tasks/[id] - body: { action: "done" | "snooze" }.
// Called by the assignee from the full-screen popup - these are the only two
// ways it can ever be dismissed.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectMongoose();
    const { id } = await params;
    const { action } = await req.json();

    if (!["done", "snooze"].includes(action)) {
      return NextResponse.json({ error: "action must be 'done' or 'snooze'" }, { status: 400 });
    }

    const update =
      action === "done"
        ? { status: "done", doneAt: new Date(), snoozeUntil: null }
        : { status: "snoozed", snoozeUntil: new Date(Date.now() + SNOOZE_MS) };

    // Only a still-open task can be acted on - without this, a stale/duplicate
    // click (e.g. the popup's request landing after the task was already
    // marked done from another tab) could resurrect an already-completed task
    // back to snoozed.
    const task = await UrgentTask.findOneAndUpdate(
      { _id: id, status: { $in: ["pending", "snoozed"] } },
      update,
      { new: true }
    ).lean();
    if (!task) {
      return NextResponse.json({ error: "This task no longer exists or was already resolved" }, { status: 409 });
    }

    return NextResponse.json(task);
  } catch (error: any) {
    console.error("PATCH urgent-tasks error:", error);
    return NextResponse.json({ error: error.message || "Failed to update urgent task" }, { status: 500 });
  }
}
