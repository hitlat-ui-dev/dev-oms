import { NextResponse } from "next/server";
import mongoose from "mongoose";

export async function GET() {
  try {
    // 1. Force establish connection pool using your system environment variable
    if (mongoose.connection.readyState !== 1) {
      if (process.env.MONGODB_URI) {
        await mongoose.connect(process.env.MONGODB_URI);
      } else {
        return NextResponse.json(
          { error: "Database disconnected and MONGODB_URI missing from .env file." },
          { status: 500 }
        );
      }
    }

    const db = mongoose.connection.db;
    if (!db) {
      return NextResponse.json({ error: "Database instance not found" }, { status: 500 });
    }

    // 2. Fetch the dynamic list of collections directly from your dev_oms_db cluster
    const collectionsList = await db.listCollections().toArray();
    const backupData: Record<string, any[]> = {};

    // 3. Loop through and pull records safely (handles spaces in names perfectly)
    for (const col of collectionsList) {
      const collectionName = col.name;

      // Skip default internal system configuration logs if they exist
      if (collectionName.startsWith("system.")) continue;

      // Use native db collection handling to safely fetch names with spaces
      const documents = await db.collection(collectionName).find({}).toArray();
      backupData[collectionName] = documents;
    }

    // 4. Send back the clean database payload dump
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      database: db.databaseName, // This will be "dev_oms_db"
      collections: backupData,
    });

  } catch (error: any) {
    console.error("❌ Backup API System Error Trace:", error);
    return NextResponse.json(
      { error: error.message || "Internal server backup processing failed" },
      { status: 500 }
    );
  }
}