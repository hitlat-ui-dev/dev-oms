import { NextResponse } from "next/server";
import mongoose from "mongoose";
import JSZip from "jszip";
import BackupLog from "@/models/BackupLog";
import { uploadFileToGoogleDrive } from "@/lib/googleDrive";
import { isEmailBackupConfigured, sendBackupEmail } from "@/lib/email";

const MAX_EMAIL_ATTACHMENT_BYTES = 20 * 1024 * 1024; // stay under Gmail's ~25MB message ceiling

export async function GET() {
  try {
    if (mongoose.connection.readyState !== 1 && process.env.MONGODB_URI) {
      await mongoose.connect(process.env.MONGODB_URI);
    }

    const todayDate = new Date().toISOString().split("T")[0];

    // Check if backup already completed today
    const existingLog = await BackupLog.findOne({ date: todayDate, status: "SUCCESS" });

    // Fetch latest 10 logs for status display
    const recentLogs = await BackupLog.find().sort({ timestamp: -1 }).limit(10).lean();

    return NextResponse.json({
      success: true,
      todayBackupCompleted: !!existingLog,
      todayLog: existingLog || null,
      history: recentLogs,
      driveConfigured: !!(process.env.GOOGLE_DRIVE_CLIENT_EMAIL && process.env.GOOGLE_DRIVE_PRIVATE_KEY),
      emailConfigured: isEmailBackupConfigured(),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (mongoose.connection.readyState !== 1) {
      if (process.env.MONGODB_URI) {
        await mongoose.connect(process.env.MONGODB_URI);
      } else {
        return NextResponse.json({ error: "MONGODB_URI missing" }, { status: 500 });
      }
    }

    const todayDate = new Date().toISOString().split("T")[0];

    // Check if backup already ran successfully today
    const existingLog = await BackupLog.findOne({ date: todayDate, status: "SUCCESS" });

    let forceRun = false;
    try {
      const body = await req.json();
      forceRun = !!body?.force;
    } catch {
      // Body empty or invalid JSON, ignore
    }

    if (existingLog && !forceRun) {
      return NextResponse.json({
        skipped: true,
        message: `Backup already created and saved for today (${todayDate}).`,
        log: existingLog,
      });
    }

    // Lock today's backup entry to prevent concurrency collisions
    await BackupLog.findOneAndUpdate(
      { date: todayDate },
      { status: "IN_PROGRESS", timestamp: new Date(), error: null },
      { upsert: true, new: true }
    );

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error("Database instance unavailable");
    }

    // 1. Fetch data collections from MongoDB
    const collectionsList = await db.listCollections().toArray();
    const backupData: Record<string, any[]> = {};
    let totalRecordsCount = 0;
    let collectionsCount = 0;

    for (const col of collectionsList) {
      if (col.name.startsWith("system.")) continue;
      const documents = await db.collection(col.name).find({}).toArray();
      backupData[col.name] = documents;
      totalRecordsCount += documents.length;
      collectionsCount += 1;
    }

    // 2. Build ZIP File Buffer using JSZip
    const zip = new JSZip();
    const folderName = `${db.databaseName}_backup_${todayDate}`;
    const backupFolder = zip.folder(folderName);

    if (!backupFolder) throw new Error("Failed to create ZIP container");

    Object.keys(backupData).forEach((colName) => {
      backupFolder.file(`${colName}.json`, JSON.stringify(backupData[colName], null, 2));
    });

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const fileName = `${folderName}.zip`;

    // 3. Deliver the backup via every configured channel (Gmail email / Cloudflare R2 / Google Drive)
    let driveFileId = "";
    const channelMessages: string[] = [];
    let anyChannelConfigured = false;
    let anyChannelSucceeded = false;

    if (isEmailBackupConfigured()) {
      anyChannelConfigured = true;
      if (zipBuffer.length > MAX_EMAIL_ATTACHMENT_BYTES) {
        channelMessages.push(
          `Email skipped — backup is ${(zipBuffer.length / (1024 * 1024)).toFixed(1)}MB, over Gmail's attachment limit.`
        );
      } else {
        try {
          await sendBackupEmail(zipBuffer, fileName, {
            collectionsCount,
            recordsCount: totalRecordsCount,
            dateLabel: todayDate,
          });
          channelMessages.push("Emailed to Gmail successfully.");
          anyChannelSucceeded = true;
        } catch (emailError: any) {
          console.error("❌ Backup Email Error:", emailError);
          channelMessages.push(`Email failed: ${emailError.message}`);
        }
      }
    }

    if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) {
      anyChannelConfigured = true;
      try {
        const { uploadFileToR2 } = await import("@/lib/cloudflareR2");
        await uploadFileToR2(zipBuffer, fileName);
        channelMessages.push("Uploaded to Cloudflare R2.");
        anyChannelSucceeded = true;
      } catch (r2Error: any) {
        console.error("❌ Cloudflare R2 Upload Error:", r2Error);
        channelMessages.push(`Cloudflare R2 upload failed: ${r2Error.message}`);
      }
    } else if (process.env.GOOGLE_DRIVE_CLIENT_EMAIL && process.env.GOOGLE_DRIVE_PRIVATE_KEY) {
      anyChannelConfigured = true;
      try {
        const driveResponse = await uploadFileToGoogleDrive(zipBuffer, fileName);
        driveFileId = driveResponse.id || "";
        channelMessages.push("Uploaded to Google Drive.");
        anyChannelSucceeded = true;
      } catch (uploadError: any) {
        console.error("❌ Google Drive Upload Error:", uploadError);
        channelMessages.push(`Google Drive upload failed: ${uploadError.message}`);
      }
    }

    if (!anyChannelConfigured) {
      channelMessages.push("Backup compiled locally but no delivery channel (Gmail/R2/Drive) is configured in .env.local.");
    }

    const uploadStatus: "SUCCESS" | "FAILED" = anyChannelConfigured && !anyChannelSucceeded ? "FAILED" : "SUCCESS";
    const errorMessage = channelMessages.join(" ");

    // 4. Update BackupLog record
    const updatedLog = await BackupLog.findOneAndUpdate(
      { date: todayDate },
      {
        status: uploadStatus,
        fileName: fileName,
        fileId: driveFileId,
        fileSize: zipBuffer.length,
        collectionsCount,
        recordsCount: totalRecordsCount,
        timestamp: new Date(),
        error: errorMessage || undefined,
        triggeredBy: "AUTO_SITE_ACCESS",
      },
      { new: true }
    );

    if (uploadStatus === "FAILED") {
      return NextResponse.json(
        {
          success: false,
          error: errorMessage,
          log: updatedLog,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: errorMessage || `Auto backup completed successfully and uploaded to Google Drive.`,
      log: updatedLog,
    });
  } catch (error: any) {
    console.error("❌ Auto Backup Route Execution Error:", error);

    const todayDate = new Date().toISOString().split("T")[0];
    await BackupLog.findOneAndUpdate(
      { date: todayDate },
      { status: "FAILED", error: error.message || "Unknown backup error", timestamp: new Date() },
      { upsert: true }
    );

    return NextResponse.json(
      { error: error.message || "Auto backup failed" },
      { status: 500 }
    );
  }
}
