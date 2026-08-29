import { NextResponse } from "next/server";
import mongoose from "mongoose";
import UrgentTask from "@/models/UrgentTask";

async function connectMongoose() {
  if (mongoose.connection.readyState !== 1 && process.env.MONGODB_URI) {
    await mongoose.connect(process.env.MONGODB_URI);
  }
}

const ESCALATE_AFTER_MS = 60 * 60 * 1000; // 1 hour

// Escalation is computed on read, not by a background job - there's no
// always-on process in this Next.js/Vercel app to run a periodic timer in
// (no Express server.js, no Socket.io), and a task's "pending for over an
// hour" state is fully derivable from createdAt + status at query time
// anyway, so a stored flag+cron would only add a moving part with nothing to
// show for it.
function withEscalation(doc: any) {
  const pendingMs = Date.now() - new Date(doc.createdAt).getTime();
  return {
    ...doc,
    escalated: doc.status !== "done" && pendingMs >= ESCALATE_AFTER_MS,
    pendingMinutes: Math.floor(pendingMs / 60000),
  };
}

// GET /api/urgent-tasks?username=X - tasks currently DUE for that person to
// see (pending, or snoozed with snoozeUntil already passed) - polled by the
// global popup every ~25s (see components/UrgentTaskPopup.tsx).
// GET /api/urgent-tasks (no username) - every open (pending/snoozed) task
// system-wide, for the owner dashboard.
export async function GET(req: Request) {
  try {
    await connectMongoose();
    const { searchParams } = new URL(req.url);
    const username = searchParams.get("username");

    if (username) {
      const tasks = await UrgentTask.find({
        assignedTo: username,
        $or: [{ status: "pending" }, { status: "snoozed", snoozeUntil: { $lte: new Date() } }],
      })
        .sort({ createdAt: 1 })
        .lean();
      return NextResponse.json(tasks.map(withEscalation));
    }

    const tasks = await UrgentTask.find({ status: { $in: ["pending", "snoozed"] } })
      .sort({ createdAt: 1 })
      .lean();
    return NextResponse.json(tasks.map(withEscalation));
  } catch (error: any) {
    console.error("GET urgent-tasks error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch urgent tasks" }, { status: 500 });
  }
}

// POST /api/urgent-tasks - owner creates a new urgent task.
export async function POST(req: Request) {
  try {
    await connectMongoose();
    const { description, assignedTo, assignedBy } = await req.json();

    if (!description?.trim() || !assignedTo || !assignedBy) {
      return NextResponse.json({ error: "description, assignedTo and assignedBy are required" }, { status: 400 });
    }

    const task = await UrgentTask.create({ description: description.trim(), assignedTo, assignedBy });
    return NextResponse.json(withEscalation(task.toObject()), { status: 201 });
  } catch (error: any) {
    console.error("POST urgent-tasks error:", error);
    return NextResponse.json({ error: error.message || "Failed to create urgent task" }, { status: 500 });
  }
}
