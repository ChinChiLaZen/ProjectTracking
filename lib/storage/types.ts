// Session 16: a swappable storage backend (S3 in prod, local disk in dev),
// per §10 Phase 3's own wording. Deliberately minimal — both upload and
// download proxy through the Next.js server (no presigned direct-to-S3
// URLs this session, flagged as a future optimization once file size/
// volume actually matters), so the interface only needs two operations.
//
// Adapters move bytes only, not metadata — Attachment.mimeType (the DB
// row) is the canonical content type, not whatever a storage backend
// happens to report back. This keeps both adapters symmetric (local disk
// needs no metadata sidecar file) and matches how this codebase already
// prefers a canonical DB value over a backend/embedded one elsewhere
// (e.g. status columns store optionId, never the label).
export interface StorageAdapter {
  upload(params: { key: string; body: Buffer; contentType: string }): Promise<void>;
  // Returns null if the key doesn't exist (the download route 404s on that).
  download(key: string): Promise<Buffer | null>;
}
