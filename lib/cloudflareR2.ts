import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

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
