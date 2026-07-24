"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";

// Session 15: mounted independently in app/page.tsx and the board page —
// not a new shared layout/header, to avoid scope creep into site-wide
// navigation (a separate, already-flagged Session 6 gap). Polls
// unreadCount every 30s per §13's default ("polling + optimistic updates"
// until a real-time transport exists). Links to a notification's board
// only, not the specific comment — no deep-linking mechanism exists
// anywhere in the app yet (same limitation Session 12's search has).
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();

  const unread = trpc.notification.unreadCount.useQuery(undefined, { refetchInterval: 30_000 });
  const list = trpc.notification.list.useInfiniteQuery(
    {},
    { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined, enabled: open },
  );

  const markRead = trpc.notification.markRead.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate();
      utils.notification.unreadCount.invalidate();
    },
  });
  const markAllRead = trpc.notification.markAllRead.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate();
      utils.notification.unreadCount.invalidate();
    },
  });

  const entries = (list.data?.pages ?? []).flatMap((page) => page.entries);

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label="Notifications" style={{ position: "relative" }}>
        🔔
        {!!unread.data && unread.data > 0 && (
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              background: "crimson",
              color: "#fff",
              borderRadius: "50%",
              fontSize: "0.65rem",
              padding: "0 0.35rem",
              minWidth: "1rem",
              textAlign: "center",
            }}
          >
            {unread.data}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          style={{
            position: "absolute",
            right: 0,
            top: "100%",
            marginTop: "0.25rem",
            width: "22rem",
            maxHeight: "24rem",
            overflowY: "auto",
            background: "#fff",
            border: "1px solid #ccc",
            borderRadius: 4,
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            zIndex: 1000,
            padding: "0.5rem",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <strong>Notifications</strong>
            <button type="button" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending || !unread.data}>
              Mark all read
            </button>
          </div>

          {list.isLoading && <p>Loading…</p>}
          {!list.isLoading && entries.length === 0 && <p style={{ color: "#888" }}>No notifications yet.</p>}

          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {entries.map((entry) => (
              <li key={entry.id} data-testid={`notification-${entry.id}`} style={{ padding: "0.4rem 0", borderBottom: "1px solid #eee" }}>
                <Link
                  href={`/${entry.workspaceId}/boards/${entry.boardId}`}
                  onClick={() => {
                    if (!entry.readAt) markRead.mutate({ notificationId: entry.id });
                    setOpen(false);
                  }}
                  style={{ color: "inherit", textDecoration: "none", fontWeight: entry.readAt ? "normal" : "bold" }}
                >
                  <div style={{ fontSize: "0.75rem", color: "#888" }}>
                    {entry.boardName} — {entry.itemName} — {new Date(entry.createdAt).toLocaleString()}
                  </div>
                  <div>{entry.updateBody}</div>
                </Link>
              </li>
            ))}
          </ul>

          {list.hasNextPage && (
            <button type="button" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
              {list.isFetchingNextPage ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
