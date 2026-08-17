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
    await orderPlacePurchase.createIndex({ createdAt: -1 });
    indexResults["Order place Purchase"] = ["{ sku: 1 }", "{ orderNo: 1 }", "{ createdAt: -1 }"];

    // 4. account_statements collection
    const accountStatements = db.collection("account_statements");
    await accountStatements.createIndex({ firmCode: 1, date: -1 });
    await accountStatements.createIndex({ processed: 1 });
    indexResults["account_statements"] = ["{ firmCode: 1, date: -1 }", "{ processed: 1 }"];

    // 5. bank_reconciliation_matches collection - the documents' actual field
    // is "status" (matchStatus doesn't exist on them), so an index on
    // matchStatus was dead weight; every query filtering by status/firmCode
    // was falling back to a collection scan.
    const matches = db.collection("bank_reconciliation_matches");
    await matches.createIndex({ firmCode: 1, status: 1 });
    await matches.createIndex({ sellerId: 1 });
    indexResults["bank_reconciliation_matches"] = ["{ firmCode: 1, status: 1 }", "{ sellerId: 1 }"];

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

    // 8. items collection
    const items = db.collection("items");
    await items.createIndex({ sku: 1 }, { unique: true, sparse: true });
    await items.createIndex({ category: 1 });
    await items.createIndex({ itemName: 1 });
    // Multikey index on the per-item audit-log array - the Summary dashboard's
    // "today's activity" query now $elemMatch-filters on history.date before
    // unwinding, which needs this to avoid scanning every item's full history.
    await items.createIndex({ "history.date": 1 });
    indexResults["items"] = ["{ sku: 1 }", "{ category: 1 }", "{ itemName: 1 }", "{ history.date: 1 }"];

    // 9. stock collection - no Mongoose model, queried/updated by sku on
    // nearly every order/purchase/return write across the app, but never had
    // an index (this was the single biggest missing index found in the audit)
    const stock = db.collection("stock");
    await stock.createIndex({ sku: 1 });
    indexResults["stock"] = ["{ sku: 1 }"];

    // 10. purchase_requests collection
    const purchaseRequests = db.collection("purchase_requests");
    await purchaseRequests.createIndex({ sku: 1 });
    await purchaseRequests.createIndex({ status: 1 });
    await purchaseRequests.createIndex({ itemName: 1 });
    indexResults["purchase_requests"] = ["{ sku: 1 }", "{ status: 1 }", "{ itemName: 1 }"];

    // 11. companies collection
    const companies = db.collection("companies");
    await companies.createIndex({ createdAt: -1 });
    await companies.createIndex({ firmCode: 1 });
    indexResults["companies"] = ["{ createdAt: -1 }", "{ firmCode: 1 }"];

    // 12. transporters collection
    const transporters = db.collection("transporters");
    await transporters.createIndex({ createdAt: -1 });
    indexResults["transporters"] = ["{ createdAt: -1 }"];

    // 13. todo_tasks collection - Header polls this (now filtered to
    // status=Pending) on every navigation across the whole app.
    const todoTasks = db.collection("todo_tasks");
    await todoTasks.createIndex({ status: 1, createdAt: -1 });
    indexResults["todo_tasks"] = ["{ status: 1, createdAt: -1 }"];

    // 14/15. chat_messages / direct_messages - also fetched by Header on
    // every navigation across the whole app.
    const chatMessages = db.collection("chat_messages");
    await chatMessages.createIndex({ createdAt: -1 });
    indexResults["chat_messages"] = ["{ createdAt: -1 }"];

    const directMessages = db.collection("direct_messages");
    await directMessages.createIndex({ sender: 1 });
    await directMessages.createIndex({ recipient: 1 });
    indexResults["direct_messages"] = ["{ sender: 1 }", "{ recipient: 1 }"];

    // 16. gem_bids collection - sorted by updatedAt on every GeM Bids board load.
    const gemBids = db.collection("gem_bids");
    await gemBids.createIndex({ updatedAt: -1 });
    indexResults["gem_bids"] = ["{ updatedAt: -1 }"];

    // 17. gem_sheets - multikey index backing the Summary dashboard's
    // $elemMatch pre-filter on uploadedRows.completedAt (see dashboard-summary route).
    const gemSheets = db.collection("gem_sheets");
    await gemSheets.createIndex({ "uploadedRows.completedAt": 1 });
    indexResults["gem_sheets"] = ["{ uploadedRows.completedAt: 1 }"];

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
