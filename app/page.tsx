"use client";

import { signOut, useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc/client";

export default function Home() {
  const { data: session, status } = useSession();
  const workspaces = trpc.workspace.list.useQuery(undefined, { enabled: status === "authenticated" });

  if (status === "loading") return null;

  if (status !== "authenticated") {
    return (
      <main style={{ maxWidth: 480, margin: "4rem auto" }}>
        <p>
          Not signed in. <a href="/sign-in">Sign in</a>
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
      <ul>{workspaces.data?.map((w) => <li key={w.id}>{w.name}</li>)}</ul>
    </main>
  );
}
