import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, validateUpload } from "./validateUpload";

// A real, fully-valid 1x1 transparent PNG — file-type parses the IHDR
// chunk, not just the 8-byte signature, so a hand-truncated signature-only
// buffer isn't enough to be recognized as PNG.
const PNG_SIGNATURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PDF_SIGNATURE = Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3", "binary");

describe("validateUpload", () => {
  it("accepts a real PNG by its magic bytes, regardless of declared name", async () => {
    const result = await validateUpload(PNG_SIGNATURE, "whatever.bin");
    expect(result).toEqual({ ok: true, mimeType: "image/png" });
  });

  it("accepts a real JPEG by its magic bytes", async () => {
    const result = await validateUpload(JPEG_SIGNATURE, "photo.jpg");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mimeType).toBe("image/jpeg");
  });

  it("accepts a real PDF by its magic bytes", async () => {
    const result = await validateUpload(PDF_SIGNATURE, "doc.pdf");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mimeType).toBe("application/pdf");
  });

  it("rejects an empty file", async () => {
    const result = await validateUpload(Buffer.alloc(0), "empty.png");
    expect(result).toEqual({ ok: false, reason: "File is empty." });
  });

  it("rejects a file over the size cap", async () => {
    const oversized = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(MAX_UPLOAD_BYTES)]);
    const result = await validateUpload(oversized, "big.png");
    expect(result.ok).toBe(false);
  });

  it("rejects content whose real bytes don't match any allowed signature, even with a trusted-looking extension", async () => {
    // A file claiming to be "photo.jpg" but whose actual bytes are a
    // plain shell script — exactly the case §12's "sniffing, not just
    // extension" guidance exists to catch.
    const fakeScript = Buffer.from("#!/bin/sh\necho hacked\n");
    const result = await validateUpload(fakeScript, "photo.jpg");
    expect(result.ok).toBe(false);
  });

  it("rejects a real but disallowed file type (e.g. a zip)", async () => {
    const zipSignature = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const result = await validateUpload(zipSignature, "archive.zip");
    expect(result.ok).toBe(false);
  });

  it("falls back to the declared extension only for text/csv (no byte signature to sniff)", async () => {
    const plainText = Buffer.from("just some notes, no magic bytes here");
    const txtResult = await validateUpload(plainText, "notes.txt");
    expect(txtResult).toEqual({ ok: true, mimeType: "text/plain" });

    const csvResult = await validateUpload(plainText, "data.csv");
    expect(csvResult).toEqual({ ok: true, mimeType: "text/csv" });
  });

  it("rejects unsniffable content with no recognized extension fallback", async () => {
    const plainText = Buffer.from("mystery content");
    const result = await validateUpload(plainText, "mystery.xyz");
    expect(result).toEqual({ ok: false, reason: "Could not determine file type from its content." });
  });
});
