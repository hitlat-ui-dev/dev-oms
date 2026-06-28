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

    // Fetch received purchase records to retroactively map rates
    const receivedPurchases = await db.collection("Received purchase").find({ sku }).toArray();
    const receivedMap: any = {};
    receivedPurchases.forEach((rp: any) => {
      if (rp.orderNumber) {
        receivedMap[rp.orderNumber] = rp.rate;
      }
    });

    // Fetch seller orders to retroactively map sales rates
    const sellerOrders = await db.collection("sellerorders").find({ sku }).toArray();
    const salesMap: any = {};
    sellerOrders.forEach((so: any) => {
      if (so.orderNo) {
        salesMap[so.orderNo] = so.rate;
      }
    });

    let history = item.history || [];
    history = history.map((entry: any) => {
      const newEntry = { ...entry };
      if (newEntry.rate === undefined || newEntry.rate === null) {
        const typeStr = String(newEntry.type || "").toUpperCase();
        if (typeStr.includes("PURCHASE") && newEntry.orderNo && receivedMap[newEntry.orderNo] !== undefined) {
          newEntry.rate = receivedMap[newEntry.orderNo];
        } else if ((typeStr.includes("SELL") || typeStr.includes("HISAB")) && newEntry.orderNo && salesMap[newEntry.orderNo] !== undefined) {
          newEntry.rate = salesMap[newEntry.orderNo];
        }
      }
      return newEntry;
    });

    return NextResponse.json({
      itemName: item.itemName,
      sku: item.sku,
      currentStock: item.currentStock,
      reQty: item.reQty,
      // We send the history reversed so the newest transaction is at the top
      history: history.reverse()
    });
  } catch (e) {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}