import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

const COLLECTION = "dc_item_masters";

function nameKeyFor(itemName: string): string {
  return itemName.trim().toLowerCase().replace(/\s+/g, " ");
}

// PATCH /api/dc-item-master/[id] - rename a master item or change its default
// unit. Only the dropdown's own list is touched: challan lines snapshot their
// item name at save time, so already-issued challans keep what they printed.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid item id" }, { status: 400 });
    }

    const body = await req.json();
    const client = await clientPromise;
    const db = client.db();

    const update: Record<string, any> = { updatedAt: new Date() };

    if (body.itemName !== undefined) {
      const itemName = (body.itemName || "").toString().trim();
      if (!itemName) {
        return NextResponse.json({ error: "itemName cannot be blank." }, { status: 400 });
      }
      const nameKey = nameKeyFor(itemName);
      const clash = await db.collection(COLLECTION).findOne({ nameKey, _id: { $ne: new ObjectId(id) } });
      if (clash) {
        return NextResponse.json({ error: `"${itemName}" is already in the item list.` }, { status: 400 });
      }
      update.itemName = itemName;
      update.nameKey = nameKey;
    }

    if (body.unit !== undefined) {
      update.unit = (body.unit || "").toString().trim();
    }

    const result = await db.collection(COLLECTION).updateOne({ _id: new ObjectId(id) }, { $set: update });
    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("PATCH dc-item-master error:", error);
    return NextResponse.json({ error: error.message || "Failed to update DC item" }, { status: 500 });
  }
}

// DELETE /api/dc-item-master/[id] - removes it from the dropdown only.
// Challans that already used it are untouched (their lines carry their own
// itemName copy), so this is safe even for a well-used item.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid item id" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();
    const result = await db.collection(COLLECTION).deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE dc-item-master error:", error);
    return NextResponse.json({ error: error.message || "Failed to delete DC item" }, { status: 500 });
  }
}
