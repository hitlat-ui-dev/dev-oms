import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import Item from "@/models/Item";
import mongoose from "mongoose";

async function connectDB() {
  await clientPromise;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }
}

export async function GET() {
  try {
    await connectDB();
    const items = await Item.find({}).sort({ createdAt: -1 });

    // Logic to generate next SKU
    const lastItem = await Item.findOne().sort({ sku: -1 });
    let nextSku = "S1100";
    if (lastItem && lastItem.sku) {
      const lastNum = parseInt(lastItem.sku.replace("S", ""));
      nextSku = `S${lastNum + 1}`;
    }

    return NextResponse.json({ items, nextSku });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await connectDB();
    const data = await req.json();

    // 1. Create the Item exactly with the fields from the form (sku, itemName, currentStock, etc.)
    // We still initialize an empty history array so the report doesn't crash later
    const newItem = await Item.create({
      ...data,
      history: [
        {
          type: 'Opening Stock', // Match your model's enum
          qty: Number(data.currentStock) || 0,
          date: new Date(),
        }
      ]
    });

    if (!mongoose.connection.db) {
      throw new Error("Database connection not ready");
    }
    const stockCollection = mongoose.connection.db.collection("stock");

    // 2. Add to stock collection using the same data values
    await stockCollection.insertOne({
      itemId: newItem._id,
      sku: data.sku,
      itemName: data.itemName,
      category: data.category,
      unit: data.unit,
      location: data.location || "---",
      quantity: Number(data.currentStock) || 0, // Saves currentStock directly here
      rate: 0,
      vendor: "Opening Stock",
      reQty: 0,
      lastUpdated: new Date()
    });

    return NextResponse.json(newItem, { status: 201 });
  } catch (error: any) {
    // This logs the full error to your VS Code / Server Terminal
    console.error("Critical POST Error:", error);

    // Extract the specific message (e.g., "Path 'reason' is not in schema" or "Duplicate SKU")
    let errorMessage = "An error occurred";
    
    if (error.code === 11000) {
      errorMessage = `Duplicate SKU Error: ${JSON.stringify(error.keyValue)}`;
    } else if (error.errors) {
      errorMessage = Object.values(error.errors).map((err: any) => err.message).join(", ");
    } else {
      errorMessage = error.message || "Invalid Data";
    }

    return NextResponse.json({ error: "Duplicate SKU or Invalid Data" }, { status: 400 });
  }
}