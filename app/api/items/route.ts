import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import Item from "@/models/Item";
import mongoose from "mongoose";
import dbConnect from "@/lib/dbConnect";

async function connectDB() {
  await clientPromise;
  await dbConnect();
}

export async function GET() {
  try {
    await connectDB();
    const items = await Item.find({}).sort({ createdAt: -1 }).lean();

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

    // No index/query ever guarded against re-adding an item that already
    // exists under a different SKU - a case/whitespace-insensitive name
    // match slipped through repeatedly (16 duplicate-name groups found
    // across the live inventory before this check was added). Block it
    // here rather than just warning, since the fix for an existing
    // duplicate is a manual merge, not something worth doing twice.
    const normalizedName = String(data.itemName || "").trim();
    if (normalizedName) {
      // A hidden item is a retired duplicate on purpose - it shouldn't block
      // reusing that name, matching the DB's own partial unique index
      // (itemName_unique_visible_ci), which only applies to non-hidden items.
      const existing = await Item.findOne({
        itemName: { $regex: `^${normalizedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
        hidden: { $in: [false, null] },
      }).lean();
      if (existing) {
        return NextResponse.json(
          { error: `An item named "${normalizedName}" already exists (SKU ${(existing as any).sku}). Use that item instead of creating a new one.` },
          { status: 409 }
        );
      }
    }

    // 1. Create the Item exactly with the fields from the form (sku, itemName, currentStock, etc.)
    // We still initialize an empty history array so the report doesn't crash later
    const newItem = await Item.create({
      ...data,
      history: [
        {
          type: 'Opening Stock', // Match your model's enum
          qty: Number(data.currentStock) || 0,
          date: new Date(),
          byWhom: data.createdBy || "",
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
      variantGroup: data.variantGroup || "",
      variantLabel: data.variantLabel || "",
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