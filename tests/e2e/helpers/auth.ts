import "dotenv/config";
import { randomBytes } from "node:crypto";
import { Client } from "pg";

// authOptions uses `session: { strategy: "database" }` (server/trpc/auth.ts)
// — a session is just an opaque Session row keyed by sessionToken, not a
// signed JWT. Creating one directly and setting it as the
// next-auth.session-token cookie is the standard way to e2e-test a
// database-session NextAuth app without real OAuth or email delivery.
//
// Uses raw `pg` rather than the app's Prisma client: the generated client
// (generated/prisma/client.ts) is ESM (uses `import.meta`), which
// Playwright's own test-file transform can't load — a real environment
// mismatch, not solved by reconfiguring Playwright project-wide for one
// helper. Table/column names below match schema.prisma's Session model
// exactly (camelCase columns need quoting in raw SQL).
export async function createTestSession(email: string) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const userResult = await client.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
    const user = userResult.rows[0];
    if (!user) {
      throw new Error(`No seeded user found for ${email} — run pnpm db:seed first.`);
    }

    const sessionToken = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await client.query(
      'INSERT INTO sessions (id, "sessionToken", "userId", expires) VALUES ($1, $2, $3, $4)',
      [randomBytes(12).toString("hex"), sessionToken, user.id, expires],
    );

    return { sessionToken, expires, userId: user.id };
  } finally {
    await client.end();
  }
}
