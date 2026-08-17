import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// GET: Fetch to-do tasks. Optional ?status=Pending|Completed narrows it -
// Header polls this on every navigation across the whole app but only ever
// needs Pending tasks for its badge/dropdown, so making that filter explicit
// lets Mongo use an index instead of returning (and re-fetching) every
// completed task ever created on each page change.
export async function GET(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db();

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const filter = status ? { status } : {};

    const tasks = await db.collection("todo_tasks")
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    return NextResponse.json(tasks);
  } catch (error: any) {
    console.error("GET tasks error:", error);
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }
}

// POST: Create a new to-do task
export async function POST(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db();
    const body = await req.json();

    const { title, description, assignedTo, dueDate, reminder, createdBy } = body;

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const newTask = {
      title: title.trim(),
      description: description ? description.trim() : "",
      assignedTo: assignedTo ? assignedTo.trim() : "",
      dueDate: dueDate || "",
      reminder: reminder || "",
      status: "Pending", // Default status
      createdBy: createdBy || "Admin",
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection("todo_tasks").insertOne(newTask);

    return NextResponse.json({ success: true, task: { ...newTask, _id: result.insertedId } }, { status: 201 });
  } catch (error: any) {
    console.error("POST task error:", error);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}
