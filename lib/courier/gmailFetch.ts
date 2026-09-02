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
  // The Gmail message's own internalDate (when Gmail received it) - used both
  // to show a per-parcel "dispatch date" in the UI and to advance the
  // fetch-since checkpoint (see courier_fetch_state in parseAndMatch.ts).
  emailDate: Date;
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

// Google answers a dead refresh token with the bare string "invalid_grant",
// which is what ends up in the Courier Tracking banner - true, and useless to
// whoever is looking at it. The token itself is the thing that goes stale
// (most often because the Cloud Console consent screen is still in "Testing",
// where Google expires refresh tokens after 7 days), so say that instead.
function describeGmailAuthError(err: any): Error {
  const raw = String(err?.message || err?.response?.data?.error || "");
  if (!/invalid_grant|invalid_client|unauthorized_client/i.test(raw)) return err;
  return new Error(
    `Gmail ka refresh token ab valid nahi hai (${raw}). Naya GMAIL_API_REFRESH_TOKEN OAuth Playground se generate karke .env.local (aur Vercel env) me daalo aur server restart karo - steps is file ke top comment me hain. Baar-baar ho raha ho to Google Cloud Console -> OAuth consent screen ko "Publish App" karke Testing se Production me le jao, warna refresh token har 7 din me expire hota rehta hai.`
  );
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
 * attachment that arrived strictly after `sinceDate` (exclusive), and
 * downloads every PDF attachment found. If `sinceDate` is null (no checkpoint
 * yet - first run ever), defaults to "yesterday" to match the original
 * behaviour.
 *
 * Gmail's own after:/before: search operators are day-granularity, not exact
 * timestamps, so a message on the same calendar day as `sinceDate` could
 * legally be included by the query even though we already processed it (or
 * legally excluded even though it's new, depending on server/Gmail timezone
 * skew). To stay correct regardless of that, the query window is widened by
 * one extra day on the "after" side, has no upper bound (fetch everything up
 * to now - this is what lets a missed day get caught up automatically), and
 * every message's exact `internalDate` is then filtered in code against
 * `sinceDate` so nothing already processed is re-fetched.
 */
export async function fetchNewCourierPdfsSince(sinceDate: Date | null): Promise<FetchedPdf[]> {
  const senderEmail = process.env.COURIER_SENDER_EMAIL;
  if (!senderEmail) {
    throw new Error("COURIER_SENDER_EMAIL is not set in .env.local.");
  }

  const gmail = getGmailClient();

  const effectiveSince = sinceDate ?? (() => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    return yesterday;
  })();

  const queryWindowStart = new Date(effectiveSince);
  queryWindowStart.setDate(queryWindowStart.getDate() - 1);

  const query = `from:${senderEmail} has:attachment filename:pdf after:${formatGmailDate(queryWindowStart)}`;

  // First call against Gmail - this is where a stale refresh token surfaces,
  // since googleapis only redeems it lazily on the first request.
  let messages;
  try {
    const listRes = await gmail.users.messages.list({ userId: "me", q: query });
    messages = listRes.data.messages || [];
  } catch (err: any) {
    throw describeGmailAuthError(err);
  }

  const pdfs: FetchedPdf[] = [];

  for (const msgRef of messages) {
    if (!msgRef.id) continue;
    const msgRes = await gmail.users.messages.get({ userId: "me", id: msgRef.id, format: "full" });

    const internalDateMs = Number(msgRes.data.internalDate);
    if (!internalDateMs || internalDateMs <= effectiveSince.getTime()) continue; // already processed

    const emailDate = new Date(internalDateMs);
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
      pdfs.push({ filename: part.filename || `courier_${msgRef.id}.pdf`, buffer: decodeBase64Url(data), emailDate });
    }
  }

  return pdfs;
}
