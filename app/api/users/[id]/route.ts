import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

// PUT: Update user permissions or details
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const client = await clientPromise;
    const db = client.db();

    // 1. Await the params first!
    const { id } = await params; 

    // 2. Now the length check will work correctly
    if (!id || id.length !== 24) {
      return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
    }

    const body = await req.json();
    const { _id, ...updateData } = body;

    const result = await db.collection("users").updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "User updated successfully" });
  } catch (error) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}

// DELETE: Remove a user
export async function DELETE(
  req: NextRequest, 
  { params }: { params: Promise<{ id: string }> } // Change: params is now a Promise
) {
  try {
    const client = await clientPromise;
    const db = client.db();
    
    // Await the params to extract the id
    const { id } = await params;

    if (!id || id.length !== 24) {
      return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
    }

    const result = await db.collection("users").deleteOne({
      _id: new ObjectId(id)
    });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "User deleted" });
  } catch (error) {
    console.error("Delete error:", error);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}