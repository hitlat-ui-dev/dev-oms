import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Get S3 Client configured for Cloudflare R2
 */
export function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, or R2_SECRET_ACCESS_KEY environment variables.");
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

/**
 * Upload file buffer to Cloudflare R2 bucket
 */
export async function uploadFileToR2(
  buffer: Buffer,
  fileName: string,
  contentType: string = "application/zip"
) {
  const s3Client = getR2Client();
  const bucketName = process.env.R2_BUCKET_NAME || "dev-oms-backups";

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileName,
    Body: buffer,
    ContentType: contentType,
  });

  const response = await s3Client.send(command);
  return {
    success: true,
    fileName,
    bucket: bucketName,
    etag: response.ETag,
  };
}

/**
 * Delete an object from the R2 bucket (e.g. replacing/removing a firm's
 * vault document, sign, stamp, or letterhead).
 */
export async function deleteFileFromR2(key: string) {
  const s3Client = getR2Client();
  const bucketName = process.env.R2_BUCKET_NAME || "dev-oms-backups";

  await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
  return { success: true, key };
}

/**
 * Fetch an object's raw bytes from R2 (used server-side when the PDF engine
 * needs to load a firm's uploaded documents/letterhead/sign/stamp to merge).
 */
export async function getFileFromR2(key: string): Promise<Buffer> {
  const s3Client = getR2Client();
  const bucketName = process.env.R2_BUCKET_NAME || "dev-oms-backups";

  const response = await s3Client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
  const bytes = await response.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

/**
 * A time-limited download URL for a private object — kept off the client
 * entirely otherwise, per the R2 spec's security note (never expose the
 * bucket publicly or hand out the R2 credentials themselves).
 */
export async function getSignedDownloadUrl(key: string, expirySeconds = 3600): Promise<string> {
  const s3Client = getR2Client();
  const bucketName = process.env.R2_BUCKET_NAME || "dev-oms-backups";

  const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
  return getSignedUrl(s3Client, command, { expiresIn: expirySeconds });
}
