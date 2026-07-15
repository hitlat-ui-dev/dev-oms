import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// GET: Fetch last 100 chat messages
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db();

    const messages = await db.collection("chat_messages")
      .find({})
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    // Return in chronological order
    return NextResponse.json(messages.reverse());
  } catch (error: any) {
    console.error("GET chat error:", error);
    return NextResponse.json({ error: "Failed to fetch chat messages" }, { status: 500 });
  }
}

// POST: Post a new chat message
export async function POST(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db();
    const body = await req.json();

    const { sender, message } = body;

    if (!sender || !message) {
      return NextResponse.json({ error: "Sender and message are required" }, { status: 400 });
    }

    const newMessage = {
      sender: sender.trim(),
      message: message.trim(),
      createdAt: new Date()
    };

    await db.collection("chat_messages").insertOne(newMessage);

    return NextResponse.json({ success: true, message: newMessage }, { status: 201 });
  } catch (error: any) {
    console.error("POST chat error:", error);
    return NextResponse.json({ error: "Failed to post message" }, { status: 500 });
  }
}
