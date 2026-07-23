import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { prisma } from "../db/client";

// Tenancy is derived here, from the session — never trusted from client
// input (Ground rule #4). A user with memberships in multiple orgs picking
// "first membership" is a known Session-1 simplification; an explicit
// active-organization switcher is Phase 1+ scope.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by fetchRequestHandler's createContext signature
export async function createContext(_opts: FetchCreateContextFnOptions) {
  const session = await getServerSession(authOptions);

  let userId: string | undefined;
  let organizationId: string | undefined;

  if (session?.user?.id) {
    userId = session.user.id;
    const membership = await prisma.membership.findFirst({ where: { userId } });
    organizationId = membership?.organizationId;
  }

  return { prisma, session, userId, organizationId };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
