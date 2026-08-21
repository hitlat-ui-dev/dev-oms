// lib/r2Bills.ts
//
// Cloudflare R2 storage for generated bill PDFs — a SEPARATE R2 account from
// lib/cloudflareR2.ts (which is the Bid Document Vault's bucket). Same
// pattern (S3-compatible client, key-based storage, signed download URLs
// generated on demand rather than persisted), just pointed at the bills
// account's own endpoint since that's what was provisioned.

import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export function getR2BillsClient() {
  const endpoint = process.env.R2_BILLS_ENDPOINT;
  const accessKeyId = process.env.R2_BILLS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_BILLS_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing R2_BILLS_ENDPOINT, R2_BILLS_ACCESS_KEY_ID, or R2_BILLS_SECRET_ACCESS_KEY environment variables.");
  }

  return new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function billsBucket(): string {
  return process.env.R2_BILLS_BUCKET_NAME || "dev-oms-bills";
}

/** Upload a generated bill PDF to the bills R2 bucket. */
export async function uploadFileToR2Bills(buffer: Buffer, key: string, contentType = "application/pdf") {
  const s3Client = getR2BillsClient();
  const bucketName = billsBucket();

  const response = await s3Client.send(
    new PutObjectCommand({ Bucket: bucketName, Key: key, Body: buffer, ContentType: contentType })
  );

  return { success: true, key, bucket: bucketName, etag: response.ETag };
}

/** Fetch a stored bill PDF's raw bytes. */
export async function getFileFromR2Bills(key: string): Promise<Buffer> {
  const s3Client = getR2BillsClient();
  const response = await s3Client.send(new GetObjectCommand({ Bucket: billsBucket(), Key: key }));
  const bytes = await response.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

/** Time-limited download URL — the bucket itself stays private. */
export async function getSignedDownloadUrlBills(key: string, expirySeconds = 3600): Promise<string> {
  const s3Client = getR2BillsClient();
  const command = new GetObjectCommand({ Bucket: billsBucket(), Key: key });
  return getSignedUrl(s3Client, command, { expiresIn: expirySeconds });
}

/** Delete a stored bill PDF (e.g. if a bill is later voided/regenerated). */
export async function deleteFileFromR2Bills(key: string) {
  const s3Client = getR2BillsClient();
  await s3Client.send(new DeleteObjectCommand({ Bucket: billsBucket(), Key: key }));
  return { success: true, key };
}
