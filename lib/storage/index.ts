import { createLocalDiskAdapter } from "./localDiskAdapter";
import { createS3Adapter } from "./s3Adapter";
import type { StorageAdapter } from "./types";

export type { StorageAdapter } from "./types";

// Session 16: picked automatically by whether S3_BUCKET is set — local dev
// needs zero new required config (§2.1's "zero external accounts"
// philosophy), matching how the S3_* env vars were reserved-but-empty
// since Session 1.
let adapter: StorageAdapter | undefined;

export function getStorageAdapter(): StorageAdapter {
  if (!adapter) {
    adapter = process.env.S3_BUCKET ? createS3Adapter() : createLocalDiskAdapter();
  }
  return adapter;
}
