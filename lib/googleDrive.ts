import { google } from "googleapis";

/**
 * Helper to get authenticated Google Drive v3 client using Service Account credentials
 */
export function getGoogleDriveClient() {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.drive({ version: "v3", auth: oauth2Client });
  }

  // Fallback to Service Account JWT if configured
  const clientEmail = process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
  let privateKey = process.env.GOOGLE_DRIVE_PRIVATE_KEY;

  if (!clientEmail || !privateKey) {
    throw new Error("Missing Google Drive OAuth2 or Service Account environment variables.");
  }

  privateKey = privateKey.replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

  return google.drive({ version: "v3", auth });
}

/**
 * Upload buffer file directly to Google Drive folder
 */
export async function uploadFileToGoogleDrive(
  buffer: Buffer,
  fileName: string,
  mimeType: string = "application/zip"
) {
  const drive = getGoogleDriveClient();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  const fileMetadata: any = {
    name: fileName,
  };

  if (folderId) {
    fileMetadata.parents = [folderId];
  }

  const { Readable } = await import("stream");
  const media = {
    mimeType,
    body: Readable.from(buffer),
  };

  // Create file in Drive
  const response = await drive.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: "id, name, webViewLink, size, createdTime",
    supportsAllDrives: true,
  });

  // Automatically transfer permission/ownership so it consumes personal storage, not service account quota
  if (response.data.id && folderId) {
    try {
      // Get folder owner email
      const folderRes = await drive.files.get({
        fileId: folderId,
        fields: "owners",
        supportsAllDrives: true,
      });

      const ownerEmail = folderRes.data.owners?.[0]?.emailAddress;
      if (ownerEmail) {
        await drive.permissions.create({
          fileId: response.data.id,
          transferOwnership: true,
          supportsAllDrives: true,
          requestBody: {
            role: "owner",
            type: "user",
            emailAddress: ownerEmail,
          },
        });
      }
    } catch (permErr) {
      // If transfer ownership fails (e.g. standard accounts), log and continue
      console.warn("Ownership transfer notice:", permErr);
    }
  }

  return response.data;
}
