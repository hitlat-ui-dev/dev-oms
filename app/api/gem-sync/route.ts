import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// GET: Fetch the shared console state from MongoDB
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db();

    // Fetch collections
    const buyers = await db.collection("gem_buyers").find({}).toArray();
    const listings = await db.collection("gem_listings").find({}).toArray();
    const rateHistory = await db.collection("gem_rate_history").find({}).toArray();
    const customItems = await db.collection("gem_custom_items").find({}).toArray();
    const activeSheetDoc = await db.collection("gem_active_sheet").findOne({ id: "current" });

    // Clean MongoDB _id fields for React/JSON serialization
    const cleanBuyers = buyers.map(({ _id, ...rest }) => ({ ...rest }));
    const cleanListings = listings.map(({ _id, ...rest }) => ({ ...rest }));
    const cleanHistory = rateHistory.map(({ _id, ...rest }) => ({ ...rest }));
    const cleanCustomItems = customItems.map(({ _id, ...rest }) => ({ ...rest }));

    return NextResponse.json({
      buyers: cleanBuyers,
      listings: cleanListings,
      rateHistory: cleanHistory,
      customItems: cleanCustomItems,
      activeSheet: activeSheetDoc ? {
        fileName: activeSheetDoc.fileName || "",
        uploadedRows: activeSheetDoc.uploadedRows || [],
        originalExcelData: activeSheetDoc.originalExcelData || [],
        selectedBuyerId: activeSheetDoc.selectedBuyerId || ""
      } : { fileName: "", uploadedRows: [], originalExcelData: [], selectedBuyerId: "" }
    });
  } catch (error) {
    console.error("GET gem-sync error:", error);
    return NextResponse.json({ error: "Failed to fetch state" }, { status: 500 });
  }
}

// POST: Save collections/sheets to MongoDB to share across team members
export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    const client = await clientPromise;
    const db = client.db();
    const body = await req.json();

    // Map helpers to discard MongoDB native _id if they are present in incoming payload
    const sanitizeBody = (items: any[]) => {
      if (!Array.isArray(items)) return [];
      return items.map(({ _id, ...rest }) => ({ ...rest }));
    };

    if (action === "save_buyers") {
      await db.collection("gem_buyers").deleteMany({});
      const sanitized = sanitizeBody(body);
      if (sanitized.length > 0) {
        await db.collection("gem_buyers").insertMany(sanitized);
      }
      return NextResponse.json({ success: true });
    }

    if (action === "save_listings") {
      await db.collection("gem_listings").deleteMany({});
      const sanitized = sanitizeBody(body);
      if (sanitized.length > 0) {
        await db.collection("gem_listings").insertMany(sanitized);
      }
      return NextResponse.json({ success: true });
    }

    if (action === "save_history") {
      await db.collection("gem_rate_history").deleteMany({});
      const sanitized = sanitizeBody(body);
      if (sanitized.length > 0) {
        await db.collection("gem_rate_history").insertMany(sanitized);
      }
      return NextResponse.json({ success: true });
    }

    if (action === "save_custom_items") {
      await db.collection("gem_custom_items").deleteMany({});
      const sanitized = sanitizeBody(body);
      if (sanitized.length > 0) {
        await db.collection("gem_custom_items").insertMany(sanitized);
      }
      return NextResponse.json({ success: true });
    }

    if (action === "save_active_sheet") {
      const sanitizedRows = sanitizeBody(body.uploadedRows || []);
      await db.collection("gem_active_sheet").updateOne(
        { id: "current" },
        { 
          $set: { 
            fileName: body.fileName || "",
            uploadedRows: sanitizedRows,
            originalExcelData: body.originalExcelData || [],
            selectedBuyerId: body.selectedBuyerId || "",
            updatedAt: new Date().toISOString()
          } 
        },
        { upsert: true }
      );
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("POST gem-sync error:", error);
    return NextResponse.json({ error: "Failed to save state" }, { status: 500 });
  }
}
