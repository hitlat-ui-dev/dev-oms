import nodemailer from "nodemailer";

export function isEmailBackupConfigured() {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

/**
 * Email a backup ZIP as an attachment via Gmail SMTP (uses a Gmail App Password, not the account password).
 */
export async function sendBackupEmail(
  zipBuffer: Buffer,
  fileName: string,
  info: { collectionsCount: number; recordsCount: number; dateLabel: string }
) {
  const gmailUser = process.env.GMAIL_USER;
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;
  const to = process.env.BACKUP_EMAIL_TO || gmailUser;

  if (!gmailUser || !gmailAppPassword || !to) {
    throw new Error("Gmail backup email is not configured (GMAIL_USER / GMAIL_APP_PASSWORD missing in .env.local).");
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailAppPassword },
  });

  await transporter.sendMail({
    from: `"Dev OMS Backup" <${gmailUser}>`,
    to,
    subject: `Dev OMS Daily Backup — ${info.dateLabel}`,
    text: `Automatic daily database backup attached.\n\nCollections: ${info.collectionsCount}\nRecords: ${info.recordsCount}\nFile: ${fileName}`,
    attachments: [{ filename: fileName, content: zipBuffer }],
  });
}
