import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { StorageAdapter } from "./types";

// Session 16: uploads/downloads both go through this server using IAM
// credentials — the client never talks to S3 directly, no public-write
// bucket policy needed. This structurally satisfies §12's "isolate the S3
// bucket from direct public write."
export function createS3Adapter(): StorageAdapter {
  const client = new S3Client({ region: process.env.S3_REGION });
  const bucket = process.env.S3_BUCKET!;

  return {
    async upload({ key, body, contentType }) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },

    async download(key) {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const bytes = await result.Body?.transformToByteArray();
        return bytes ? Buffer.from(bytes) : null;
      } catch (err) {
        if (err instanceof NoSuchKey) return null;
        throw err;
      }
    },
  };
}
