import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import Item from "@/models/Item";

export async function GET(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db("dev_oms_db");
    const { searchParams } = new URL(req.url);
    const sku = searchParams.get("sku");

    if (!sku) {
      return NextResponse.json({ error: "SKU is required" }, { status: 400 });
    }

    // Find the item and return only the data needed for the popup
    const item = await db.collection("items").findOne({ sku });

    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    return NextResponse.json({
      itemName: item.itemName,
      sku: item.sku,
      currentStock: item.currentStock,
      reQty: item.reQty,
      // We send the history reversed so the newest transaction is at the top
      history: item.history ? item.history.reverse() : []
    });
  } catch (e) {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}