import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// GET: Fetch direct messages for a user
export async function GET(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db();
    const { searchParams } = new URL(req.url);
    const username = searchParams.get("user");

    if (!username) {
      return NextResponse.json({ error: "User is required" }, { status: 400 });
    }

    const dms = await db.collection("direct_messages")
      .find({
        $or: [
          { sender: username.trim() },
          { recipient: username.trim() }
        ]
      })
      .sort({ createdAt: 1 })
      .toArray();

    return NextResponse.json(dms);
  } catch (error: any) {
    console.error("GET DMs error:", error);
    return NextResponse.json({ error: "Failed to fetch direct messages" }, { status: 500 });
  }
}

// POST: Send a direct message
export async function POST(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db();
    const body = await req.json();
    const { sender, recipient, message } = body;

    if (!sender || !recipient || !message) {
      return NextResponse.json({ error: "Sender, recipient, and message are required" }, { status: 400 });
    }

    const newDm = {
      sender: sender.trim(),
      recipient: recipient.trim(),
      message: message.trim(),
      createdAt: new Date(),
      read: false
    };

    await db.collection("direct_messages").insertOne(newDm);

    return NextResponse.json({ success: true, message: newDm }, { status: 201 });
  } catch (error: any) {
    console.error("POST DM error:", error);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}

// PATCH: Mark messages from a specific sender to recipient as read
export async function PATCH(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db();
    const body = await req.json();
    const { sender, recipient } = body;

    if (!sender || !recipient) {
      return NextResponse.json({ error: "Sender and recipient are required" }, { status: 400 });
    }

    await db.collection("direct_messages").updateMany(
      { sender: sender.trim(), recipient: recipient.trim(), read: false },
      { $set: { read: true } }
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("PATCH DM error:", error);
    return NextResponse.json({ error: "Failed to mark messages as read" }, { status: 500 });
  }
}
