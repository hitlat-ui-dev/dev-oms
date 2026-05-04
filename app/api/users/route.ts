import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// GET: Fetch all users
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db();
    
    const users = await db.collection("users")
      .find({})
      //.project({ password: 0 }) // Security: Don't send passwords to the list
      .toArray();

    return NextResponse.json(users);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}

// POST: Create a new user
export async function POST(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db();
    
    // Safety check for empty body
    const body = await req.json();
    if (!body || !body.username || !body.password) {
      return NextResponse.json({ error: "Username and Password are required" }, { status: 400 });
    }

    const { username, password, permissions } = body;

    // Check if user already exists
    const existingUser = await db.collection("users").findOne({ username });
    if (existingUser) {
      return NextResponse.json({ error: "Username already taken" }, { status: 400 });
    }

    const newUser = {
      username,
      password, // Plain text as requested
      permissions: permissions || {}, // Default to empty object if none provided
      createdAt: new Date(),
    };

    await db.collection("users").insertOne(newUser);
    return NextResponse.json({ message: "User created successfully" }, { status: 201 });
  } catch (error) {
    console.error("POST Error:", error);
    return NextResponse.json({ error: "Creation failed" }, { status: 500 });
  }
}