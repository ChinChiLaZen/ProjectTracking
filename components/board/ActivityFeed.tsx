"use client";

import { trpc } from "@/lib/trpc/client";

// Minimal UI (Session 6) — a plain reverse-chronological list, not a
// styled/final feed. Renders whatever every mutation has already been
// writing to ActivityLog since Session 2; this is just the first reader.
function formatType(type: string): string {
  return type.replace(/[._]/g, " ");
}

export function ActivityFeed({ boardId }: { boardId: string }) {
  const query = trpc.activity.list.useInfiniteQuery(
    { boardId },
    { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
  );

  const entries = (query.data?.pages ?? []).flatMap((page) => page.entries);

  return (
    <div style={{ marginTop: "2rem", borderTop: "1px solid #ccc", paddingTop: "1rem" }}>
      <h2 style={{ fontSize: "1rem", fontWeight: 600 }}>Activity</h2>
      {query.isLoading && <p>Loading…</p>}
      {!query.isLoading && entries.length === 0 && <p>No activity yet.</p>}
      <ul style={{ listStyle: "none", padding: 0, fontSize: "0.875rem" }}>
        {entries.map((entry) => (
          <li key={entry.id} style={{ padding: "0.25rem 0", borderBottom: "1px solid #eee" }}>
            <span style={{ color: "#666" }}>{new Date(entry.createdAt).toLocaleString()}</span> —{" "}
            <strong>{formatType(entry.type)}</strong>{" "}
            <code style={{ color: "#999" }}>{JSON.stringify(entry.payload)}</code>
          </li>
        ))}
      </ul>
      {query.hasNextPage && (
        <button type="button" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
          {query.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
