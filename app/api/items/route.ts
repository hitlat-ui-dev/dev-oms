import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import Item from "@/models/Item";
import mongoose from "mongoose";

export async function POST(req: Request) {
  try {
    const { itemName, category } = await req.json();
    const client = await clientPromise;
    const db = client.db(); // Next.js standard Mongo connection

    // Ensure Mongoose is connected for the Model
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGODB_URI!);
    }

    const newItem = await Item.create({ itemName, category });
    return NextResponse.json({ message: "Item Created", item: newItem }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create item" }, { status: 500 });
  }
}

export async function GET() {
  try {
    await clientPromise; 
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGODB_URI!);
    }
    const items = await Item.find({});
    return NextResponse.json(items);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch items" }, { status: 500 });
  }
}