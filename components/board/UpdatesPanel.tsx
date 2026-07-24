"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc/client";
import { detectActiveMentionQuery, insertMentionToken, splitBodyIntoSegments, type ActiveMentionQuery } from "@/lib/mentions/mentions";
import type { BoardMember } from "@/server/services/boardMembers";
import { MentionAutocomplete } from "./MentionAutocomplete";

// A lightweight fixed-position overlay, not an in-row expansion or a new
// route (Session 13) — deliberately decoupled from BoardTable's virtualized
// rows so it can't repeat Session 6's dnd-kit/TanStack-Virtual `transform`
// collision (two layout systems fighting over one row). Delete is only
// offered for the viewer's own comments — there's no "list board members
// with roles" query yet to know client-side whether the viewer is an ADMIN
// (same gap Session 5 flagged for the person-picker); an ADMIN's override
// still exists server-side, just has no UI trigger here yet.
//
// Session 14: comment bodies can carry `@[Name](userId)` mention tokens.
// Rendering resolves a mention's *current* name live from board.listMembers
// (falling back to the name embedded in the token if the user's no longer
// on the board) — see MentionChip below. Authoring wires a small
// autocomplete: typing "@word" shows matching board members; the dropdown
// is positioned with a simple fixed offset, not real caret tracking (MVP).
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
  const membersQuery = trpc.board.listMembers.useQuery({ boardId });
  const members = membersQuery.data ?? [];

  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeQuery, setActiveQuery] = useState<ActiveMentionQuery | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
      setActiveQuery(null);
      utils.update.list.invalidate(queryInput);
    },
    onError: (err) => setError(err.message),
  });

  const deleteUpdate = trpc.update.delete.useMutation({
    onSuccess: () => utils.update.list.invalidate(queryInput),
    onError: (err) => setError(err.message),
  });

  const entries = (query.data?.pages ?? []).flatMap((page) => page.entries);

  const filteredMembers = activeQuery
    ? members
        .filter((m) => {
          const q = activeQuery.query.toLowerCase();
          return (m.name?.toLowerCase().includes(q) ?? false) || m.email.toLowerCase().includes(q);
        })
        .slice(0, 8)
    : [];

  function updateMentionState(text: string, cursorPos: number) {
    setActiveQuery(detectActiveMentionQuery(text, cursorPos));
    setActiveIndex(0);
  }

  function selectMention(member: BoardMember) {
    if (!activeQuery) return;
    const cursorPos = activeQuery.start + 1 + activeQuery.query.length;
    const { text, cursorPos: newCursorPos } = insertMentionToken(draft, activeQuery, cursorPos, member.name ?? member.email, member.userId);
    setDraft(text);
    setActiveQuery(null);
    setActiveIndex(0);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(newCursorPos, newCursorPos);
    });
  }

  function onTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!activeQuery || filteredMembers.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % filteredMembers.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + filteredMembers.length) % filteredMembers.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      selectMention(filteredMembers[activeIndex]!);
    } else if (e.key === "Escape") {
      // Close just the dropdown, not the whole panel — stop this from
      // reaching the window-level Escape listener above.
      e.preventDefault();
      e.stopPropagation();
      setActiveQuery(null);
    }
  }

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
                <div style={{ whiteSpace: "pre-wrap" }}>
                  {splitBodyIntoSegments(entry.body).map((segment, i) =>
                    segment.type === "text" ? (
                      <span key={i}>{segment.text}</span>
                    ) : (
                      <MentionChip key={i} userId={segment.userId} fallbackName={segment.name} members={members} />
                    ),
                  )}
                </div>
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
          style={{ display: "flex", flexDirection: "column", gap: "0.25rem", position: "relative" }}
        >
          {activeQuery && (
            <div style={{ position: "absolute", bottom: "100%", left: 0, marginBottom: "0.25rem", zIndex: 1 }}>
              <MentionAutocomplete members={filteredMembers} activeIndex={activeIndex} onSelect={selectMention} />
            </div>
          )}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                updateMentionState(e.target.value, e.target.selectionStart);
              }}
              onSelect={(e) => updateMentionState(e.currentTarget.value, e.currentTarget.selectionStart)}
              onKeyDown={onTextareaKeyDown}
              placeholder="Write a comment… (@ to mention someone)"
              rows={2}
              style={{ flex: 1 }}
              disabled={createUpdate.isPending}
            />
            <button type="submit" disabled={createUpdate.isPending || draft.trim().length === 0}>
              Post
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MentionChip({ userId, fallbackName, members }: { userId: string; fallbackName: string; members: BoardMember[] }) {
  const live = members.find((m) => m.userId === userId);
  const label = live?.name ?? live?.email ?? fallbackName;
  return (
    <span style={{ background: "#e0edff", color: "#1a56db", borderRadius: 4, padding: "0 0.3rem", fontWeight: 600 }}>@{label}</span>
  );
}
