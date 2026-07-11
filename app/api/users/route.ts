import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// GET: Fetch all users or specific user by username query param
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const username = searchParams.get("username");

    if (username) {
      const usernameLower = username.toLowerCase();
      if (usernameLower === "admin" || usernameLower === "chintan" || usernameLower === "hitesh") {
        return NextResponse.json({
          username: username,
          permissions: {
            boss: true,
            purchase: true,
            stock: true,
            manageStock: true,
            users: true,
            backup: true,
            addSeller: true,
            purchaseReq: true,
            addOrder: true,
            addTransporter: true,
            addMyCompanies: true,
            addNewItem: true,
            addVendor: true,
            receivePurchaseRate: true,
            stockLastRate: true,
            printLabels: true,
            hideStockItem: true,
          },
        });
      }
    }

    const client = await clientPromise;
    const db = client.db();

    if (username) {
      const user = await db.collection("users").findOne({ username });
      if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      return NextResponse.json(user);
    }

    const users = await db.collection("users")
      .find({})
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