"use client";

import { useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc/client";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Clones UpdatesPanel's exact fixed-overlay dialog shape (Session 13) —
// same reasoning: deliberately decoupled from BoardTable's virtualized
// rows, avoids any risk of the dnd-kit/TanStack-Virtual transform
// collision. Upload is a plain fetch POST with FormData, not a tRPC
// mutation — tRPC's JSON-RPC transport can't carry a file (§ Session 16
// plan). Delete is only offered for the viewer's own uploads, same
// client-side-hint-only gate UpdatesPanel already uses (ADMIN's override
// exists server-side regardless).
export function AttachmentsPanel({
  boardId,
  itemId,
  itemName,
  onClose,
}: {
  boardId: string;
  itemId: string;
  itemName: string;
  onClose: () => void;
}) {
  const { data: session } = useSession();
  const utils = trpc.useUtils();
  const queryInput = { boardId, itemId };
  const query = trpc.attachment.list.useInfiniteQuery(queryInput, {
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const deleteAttachment = trpc.attachment.delete.useMutation({
    onSuccess: () => utils.attachment.list.invalidate(queryInput),
    onError: (err) => setError(err.message),
  });

  const entries = (query.data?.pages ?? []).flatMap((page) => page.entries);

  async function handleUpload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("boardId", boardId);
      formData.append("itemId", itemId);
      formData.append("file", file);

      const res = await fetch("/api/attachments/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Upload failed (${res.status})`);
      }
      await utils.attachment.list.invalidate(queryInput);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div
      role="dialog"
      aria-label={`Attachments for ${itemName}`}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.3)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={{ background: "#fff", borderRadius: 8, padding: "1rem", width: "28rem", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
          <strong>{itemName}</strong>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {error && <p style={{ color: "crimson" }}>{error}</p>}

        <div style={{ overflowY: "auto", flex: 1, marginBottom: "0.5rem" }}>
          {query.isLoading && <p>Loading…</p>}
          {!query.isLoading && entries.length === 0 && <p style={{ color: "#888" }}>No attachments yet.</p>}
          <ul style={{ listStyle: "none", padding: 0 }}>
            {entries.map((entry) => (
              <li key={entry.id} data-testid={`attachment-${entry.id}`} style={{ padding: "0.4rem 0", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <a href={`/api/attachments/${entry.id}`} target="_blank" rel="noreferrer">
                    {entry.fileName}
                  </a>
                  <div style={{ fontSize: "0.75rem", color: "#888" }}>
                    {formatFileSize(entry.fileSize)} — {new Date(entry.createdAt).toLocaleString()}
                  </div>
                </div>
                {session?.user?.id === entry.uploaderId && (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      deleteAttachment.mutate({ boardId, attachmentId: entry.id });
                    }}
                  >
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
          {query.hasNextPage && (
            <button type="button" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              {query.isFetchingNextPage ? "Loading…" : "Load more"}
            </button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleUpload(file);
          }}
        />
        {uploading && <p style={{ color: "#888" }}>Uploading…</p>}
      </div>
    </div>
  );
}
