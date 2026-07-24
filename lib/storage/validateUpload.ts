import { fileTypeFromBuffer } from "file-type";

// §12: "Validate file uploads by content-type sniffing, not just
// extension; cap size" — stated security guidance, not optional. Real
// magic-byte sniffing via `file-type` decides acceptance; the declared
// filename is only ever used as a fallback for the two formats with no
// byte signature to sniff (plain text/CSV), never to grant trust a
// mismatched signature wouldn't otherwise earn.
//
// Deliberately narrow allowlist this session (images + PDF + text/CSV) —
// office-document formats (docx/xlsx) are technically ZIP containers and
// file-type's detection behavior for them wasn't verified against a real
// fixture here; broadening the allowlist to cover them is a follow-up,
// not assumed correct without a real file to test against.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]);

export type ValidateUploadResult = { ok: true; mimeType: string } | { ok: false; reason: string };

export async function validateUpload(buffer: Buffer, declaredFileName: string): Promise<ValidateUploadResult> {
  if (buffer.byteLength === 0) {
    return { ok: false, reason: "File is empty." };
  }
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: `File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB size limit.` };
  }

  const sniffed = await fileTypeFromBuffer(buffer);

  if (!sniffed) {
    const lower = declaredFileName.toLowerCase();
    if (lower.endsWith(".csv")) return { ok: true, mimeType: "text/csv" };
    if (lower.endsWith(".txt")) return { ok: true, mimeType: "text/plain" };
    return { ok: false, reason: "Could not determine file type from its content." };
  }

  if (!ALLOWED_MIME_TYPES.has(sniffed.mime)) {
    return { ok: false, reason: `File type "${sniffed.mime}" is not allowed.` };
  }

  return { ok: true, mimeType: sniffed.mime };
}
