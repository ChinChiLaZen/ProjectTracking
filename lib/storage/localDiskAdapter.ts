import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { StorageAdapter } from "./types";

// Session 16: dev-only adapter — a plain folder on disk (LOCAL_UPLOAD_DIR,
// default "./.uploads", gitignored). Content type is never persisted here
// (see types.ts's comment) — the DB row is the only source of truth for it.
export function createLocalDiskAdapter(): StorageAdapter {
  const root = resolve(process.env.LOCAL_UPLOAD_DIR ?? "./.uploads");

  function resolveKeyPath(key: string): string {
    // Keys are server-generated (see attachments.ts), never taken verbatim
    // from a client-supplied path — but resolve+prefix-check defends
    // against a ".." traversal regardless, cheap insurance for disk I/O.
    const path = resolve(join(root, key));
    if (!path.startsWith(root)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return path;
  }

  return {
    async upload({ key, body }) {
      const path = resolveKeyPath(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    },

    async download(key) {
      try {
        return await readFile(resolveKeyPath(key));
      } catch (err) {
        if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") return null;
        throw err;
      }
    },
  };
}
