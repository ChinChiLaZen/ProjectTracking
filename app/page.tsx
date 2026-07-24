"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc/client";
import { NotificationBell } from "@/components/NotificationBell";

// Minimal UI (Session 6) — plain inline form, no modal/design polish.
function CreateBoardForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const createBoard = trpc.board.create.useMutation({
    onSuccess: (board) => router.push(`/${workspaceId}/boards/${board.id}`),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim().length === 0) return;
        createBoard.mutate({ workspaceId, name: name.trim() });
      }}
      style={{ display: "flex", gap: "0.5rem" }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New board name"
        disabled={createBoard.isPending}
      />
      <button type="submit" disabled={createBoard.isPending || name.trim().length === 0}>
        Create board
      </button>
      {createBoard.error && <span style={{ color: "crimson" }}>{createBoard.error.message}</span>}
    </form>
  );
}

// Minimal UI (Session 12) — plain inline form + results list, matching
// CreateBoardForm's pattern. Submits on Enter/click, not per-keystroke —
// `draft` is the live input value, `submittedQuery` is what actually
// drives the query (only updated on submit).
function WorkspaceSearch({ workspaceId }: { workspaceId: string }) {
  const [draft, setDraft] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");

  const results = trpc.search.global.useQuery(
    { workspaceId, query: submittedQuery },
    { enabled: submittedQuery.trim().length > 0 },
  );

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmittedQuery(draft);
        }}
        style={{ display: "flex", gap: "0.5rem" }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Search this workspace…"
        />
        <button type="submit" disabled={draft.trim().length === 0}>
          Search
        </button>
      </form>
      {results.isLoading && <p>Searching…</p>}
      {results.error && <p style={{ color: "crimson" }}>{results.error.message}</p>}
      {results.data && (
        <ul style={{ margin: "0.5rem 0", paddingLeft: "1.25rem" }}>
          {results.data.length === 0 && <li>No results.</li>}
          {results.data.map((r) => (
            <li key={r.itemId}>
              <Link href={`/${workspaceId}/boards/${r.boardId}`}>
                {r.itemName} <span style={{ color: "#888" }}>— {r.boardName} (#{r.itemNumber})</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Home() {
  const { data: session, status } = useSession();
  const workspaces = trpc.workspace.list.useQuery(undefined, { enabled: status === "authenticated" });

  if (status === "loading") return null;

  if (status !== "authenticated") {
    return (
      <main style={{ maxWidth: 480, margin: "4rem auto" }}>
        <p>
          Not signed in. <Link href="/sign-in">Sign in</Link>
        </p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 480, margin: "4rem auto", display: "grid", gap: "1rem" }}>
      <p style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>
          Signed in as {session.user?.email} — <button onClick={() => signOut()}>Sign out</button>
        </span>
        <NotificationBell />
      </p>
      <h1>Workspaces</h1>
      {workspaces.isLoading && <p>Loading…</p>}
      <ul style={{ display: "grid", gap: "0.75rem", padding: 0, listStyle: "none" }}>
        {workspaces.data?.map((w) => (
          <li key={w.id}>
            <div>{w.name}</div>
            <CreateBoardForm workspaceId={w.id} />
            <WorkspaceSearch workspaceId={w.id} />
          </li>
        ))}
      </ul>
    </main>
  );
}
