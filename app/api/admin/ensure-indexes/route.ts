import { NextResponse } from "next/server";
import dbConnect from "@/lib/dbConnect";
import mongoose from "mongoose";

export async function GET() {
  try {
    await dbConnect();
    const db = mongoose.connection.db;
    if (!db) {
      return NextResponse.json({ error: "Database connection not initialized" }, { status: 500 });
    }

    const indexResults: Record<string, string[]> = {};

    // 1. sellerorders collection
    const sellerorders = db.collection("sellerorders");
    await sellerorders.createIndex({ firmCode: 1, createdAt: -1 });
    await sellerorders.createIndex({ sellerId: 1, createdAt: -1 });
    await sellerorders.createIndex({ sku: 1, status: 1 });
    await sellerorders.createIndex({ paymentStatus: 1, firmCode: 1 });
    await sellerorders.createIndex({ createdAt: -1 });
    indexResults["sellerorders"] = [
      "{ firmCode: 1, createdAt: -1 }",
      "{ sellerId: 1, createdAt: -1 }",
      "{ sku: 1, status: 1 }",
      "{ paymentStatus: 1, firmCode: 1 }",
      "{ createdAt: -1 }"
    ];

    // 2. Received purchase collection
    const receivedPurchase = db.collection("Received purchase");
    await receivedPurchase.createIndex({ sku: 1 });
    await receivedPurchase.createIndex({ receivedAt: -1 });
    indexResults["Received purchase"] = ["{ sku: 1 }", "{ receivedAt: -1 }"];

    // 3. Order place Purchase collection
    const orderPlacePurchase = db.collection("Order place Purchase");
    await orderPlacePurchase.createIndex({ sku: 1 });
    await orderPlacePurchase.createIndex({ orderNo: 1 });
    indexResults["Order place Purchase"] = ["{ sku: 1 }", "{ orderNo: 1 }"];

    // 4. account_statements collection
    const accountStatements = db.collection("account_statements");
    await accountStatements.createIndex({ firmCode: 1, date: -1 });
    await accountStatements.createIndex({ processed: 1 });
    indexResults["account_statements"] = ["{ firmCode: 1, date: -1 }", "{ processed: 1 }"];

    // 5. bank_reconciliation_matches collection
    const matches = db.collection("bank_reconciliation_matches");
    await matches.createIndex({ firmCode: 1, matchStatus: 1 });
    await matches.createIndex({ sellerId: 1 });
    indexResults["bank_reconciliation_matches"] = ["{ firmCode: 1, matchStatus: 1 }", "{ sellerId: 1 }"];

    // 6. gem_catalogue_links collection
    const gemLinks = db.collection("gem_catalogue_links");
    await gemLinks.createIndex({ firmCode: 1 });
    await gemLinks.createIndex({ masterItemId: 1 });
    indexResults["gem_catalogue_links"] = ["{ firmCode: 1 }", "{ masterItemId: 1 }"];

    // 7. sellers collection
    const sellers = db.collection("sellers");
    await sellers.createIndex({ instituteName: 1 });
    await sellers.createIndex({ createdAt: -1 });
    indexResults["sellers"] = ["{ instituteName: 1 }", "{ createdAt: -1 }"];

    // 8. stock / items collection
    const items = db.collection("items");
    await items.createIndex({ sku: 1 }, { unique: true, sparse: true });
    await items.createIndex({ category: 1 });
    indexResults["items"] = ["{ sku: 1 }", "{ category: 1 }"];

    return NextResponse.json({
      success: true,
      message: "Successfully ensured performance indexes across all MongoDB collections",
      indexesCreated: indexResults,
    });
  } catch (error: any) {
    console.error("Index creation error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
