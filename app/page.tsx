"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc/client";

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
      <p>
        Signed in as {session.user?.email} — <button onClick={() => signOut()}>Sign out</button>
      </p>
      <h1>Workspaces</h1>
      {workspaces.isLoading && <p>Loading…</p>}
      <ul style={{ display: "grid", gap: "0.75rem", padding: 0, listStyle: "none" }}>
        {workspaces.data?.map((w) => (
          <li key={w.id}>
            <div>{w.name}</div>
            <CreateBoardForm workspaceId={w.id} />
          </li>
        ))}
      </ul>
    </main>
  );
}
