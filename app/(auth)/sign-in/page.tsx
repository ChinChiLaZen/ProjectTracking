"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

export default function SignInPage() {
  const [email, setEmail] = useState("");

  return (
    <main style={{ maxWidth: 360, margin: "4rem auto", display: "grid", gap: "1rem" }}>
      <h1>Sign in</h1>
      <button onClick={() => signIn("google")}>Continue with Google</button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          signIn("email", { email });
        }}
        style={{ display: "grid", gap: "0.5rem" }}
      >
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit">Send magic link</button>
      </form>
    </main>
  );
}
