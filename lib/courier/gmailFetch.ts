// Fetches yesterday's courier booking-register PDF(s) from Gmail via the
// Gmail API. Mirrors lib/googleDrive.ts's OAuth2 + refresh-token pattern -
// kept as separate env vars (GMAIL_API_*) since GMAIL_USER/GMAIL_APP_PASSWORD
// (used by lib/email.ts for SMTP) are unrelated credentials with a different
// auth model entirely.
//
// ---- One-time OAuth setup (do this once, by hand) ----
// 1. Go to console.cloud.google.com, create (or pick) a project.
// 2. APIs & Services -> Library -> search "Gmail API" -> Enable.
// 3. APIs & Services -> OAuth consent screen -> configure it (External is
//    fine for personal/internal use; add your own Gmail as a test user).
// 4. APIs & Services -> Credentials -> Create Credentials -> OAuth client ID
//    -> Application type: "Desktop app" -> note the Client ID + Client Secret.
// 5. Go to developers.google.com/oauthplayground -> gear icon (top right) ->
//    check "Use your own OAuth credentials" -> paste the Client ID + Secret.
// 6. In the left panel, find "Gmail API v1" -> select the
//    https://www.googleapis.com/auth/gmail.readonly scope -> Authorize APIs
//    -> sign in with the Gmail account that receives the courier's emails.
// 7. Click "Exchange authorization code for tokens" -> copy the Refresh token.
// 8. Add to .env.local:
//      GMAIL_API_CLIENT_ID=...
//      GMAIL_API_CLIENT_SECRET=...
//      GMAIL_API_REFRESH_TOKEN=...
//      GMAIL_API_REDIRECT_URI=https://developers.google.com/oauthplayground
//      COURIER_SENDER_EMAIL=<the courier's exact sending address>

import { google } from "googleapis";

export interface FetchedPdf {
  filename: string;
  buffer: Buffer;
}

function getGmailClient() {
  const clientId = process.env.GMAIL_API_CLIENT_ID;
  const clientSecret = process.env.GMAIL_API_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_API_REFRESH_TOKEN;
  const redirectUri = process.env.GMAIL_API_REDIRECT_URI || "https://developers.google.com/oauthplayground";

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing GMAIL_API_CLIENT_ID / GMAIL_API_CLIENT_SECRET / GMAIL_API_REFRESH_TOKEN in .env.local - see the setup comment at the top of lib/courier/gmailFetch.ts."
    );
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

function formatGmailDate(d: Date): string {
  // Gmail search's after:/before: wants YYYY/MM/DD.
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

/** Base64url (Gmail's encoding) -> Buffer. */
function decodeBase64Url(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** Walks a Gmail message payload's MIME tree for PDF attachment parts. */
function findPdfParts(payload: any): any[] {
  const parts: any[] = [];
  const walk = (node: any) => {
    if (!node) return;
    const isPdf =
      node.mimeType === "application/pdf" ||
      (node.filename && node.filename.toLowerCase().endsWith(".pdf"));
    if (isPdf && node.body?.attachmentId) parts.push(node);
    if (node.parts) node.parts.forEach(walk);
  };
  walk(payload);
  return parts;
}

/**
 * Searches Gmail for mail from the courier (COURIER_SENDER_EMAIL) with a PDF
 * attachment, dated the previous calendar day (the courier's mail for a
 * given day's dispatches arrives/gets processed the next morning), and
 * downloads every PDF attachment found.
 */
export async function fetchYesterdaysCourierPdfs(): Promise<FetchedPdf[]> {
  const senderEmail = process.env.COURIER_SENDER_EMAIL;
  if (!senderEmail) {
    throw new Error("COURIER_SENDER_EMAIL is not set in .env.local.");
  }

  const gmail = getGmailClient();

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const query = `from:${senderEmail} has:attachment filename:pdf after:${formatGmailDate(yesterday)} before:${formatGmailDate(today)}`;

  const listRes = await gmail.users.messages.list({ userId: "me", q: query });
  const messages = listRes.data.messages || [];

  const pdfs: FetchedPdf[] = [];

  for (const msgRef of messages) {
    if (!msgRef.id) continue;
    const msgRes = await gmail.users.messages.get({ userId: "me", id: msgRef.id, format: "full" });
    const pdfParts = findPdfParts(msgRes.data.payload);

    for (const part of pdfParts) {
      const attachmentId = part.body.attachmentId;
      const attachRes = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId: msgRef.id,
        id: attachmentId,
      });
      const data = attachRes.data.data;
      if (!data) continue;
      pdfs.push({ filename: part.filename || `courier_${msgRef.id}.pdf`, buffer: decodeBase64Url(data) });
    }
  }

  return pdfs;
}
