"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc/client";

// A lightweight fixed-position overlay, not an in-row expansion or a new
// route (Session 13) — deliberately decoupled from BoardTable's virtualized
// rows so it can't repeat Session 6's dnd-kit/TanStack-Virtual `transform`
// collision (two layout systems fighting over one row). Delete is only
// offered for the viewer's own comments — there's no "list board members
// with roles" query yet to know client-side whether the viewer is an ADMIN
// (same gap Session 5 flagged for the person-picker); an ADMIN's override
// still exists server-side, just has no UI trigger here yet.
export function UpdatesPanel({
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
  const query = trpc.update.list.useInfiniteQuery(queryInput, {
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const createUpdate = trpc.update.create.useMutation({
    onSuccess: () => {
      setDraft("");
      utils.update.list.invalidate(queryInput);
    },
    onError: (err) => setError(err.message),
  });

  const deleteUpdate = trpc.update.delete.useMutation({
    onSuccess: () => utils.update.list.invalidate(queryInput),
    onError: (err) => setError(err.message),
  });

  const entries = (query.data?.pages ?? []).flatMap((page) => page.entries);

  return (
    <div
      role="dialog"
      aria-label={`Updates for ${itemName}`}
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
      <div style={{ background: "#fff", borderRadius: 8, padding: "1rem", width: "32rem", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
          <strong>{itemName}</strong>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {error && <p style={{ color: "crimson" }}>{error}</p>}

        <div style={{ overflowY: "auto", flex: 1, marginBottom: "0.5rem" }}>
          {query.isLoading && <p>Loading…</p>}
          {!query.isLoading && entries.length === 0 && <p style={{ color: "#888" }}>No comments yet.</p>}
          <ul style={{ listStyle: "none", padding: 0 }}>
            {entries.map((entry) => (
              <li key={entry.id} data-testid={`update-${entry.id}`} style={{ padding: "0.4rem 0", borderBottom: "1px solid #eee" }}>
                <div style={{ fontSize: "0.75rem", color: "#888" }}>
                  {entry.authorId} — {new Date(entry.createdAt).toLocaleString()}
                  {session?.user?.id === entry.authorId && (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        deleteUpdate.mutate({ boardId, updateId: entry.id });
                      }}
                      style={{ marginLeft: "0.5rem" }}
                    >
                      Delete
                    </button>
                  )}
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{entry.body}</div>
              </li>
            ))}
          </ul>
          {query.hasNextPage && (
            <button type="button" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              {query.isFetchingNextPage ? "Loading…" : "Load more"}
            </button>
          )}
        </div>

        <form
          aria-label="Add comment"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (draft.trim().length === 0) return;
            createUpdate.mutate({ boardId, itemId, body: draft.trim() });
          }}
          style={{ display: "flex", gap: "0.5rem" }}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a comment…"
            rows={2}
            style={{ flex: 1 }}
            disabled={createUpdate.isPending}
          />
          <button type="submit" disabled={createUpdate.isPending || draft.trim().length === 0}>
            Post
          </button>
        </form>
      </div>
    </div>
  );
}
