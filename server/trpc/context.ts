import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { prisma } from "../db/client";

// Tenancy is derived here, from the session — never trusted from client
// input (Ground rule #4). A user with memberships in multiple orgs picking
// "first membership" is a known Session-1 simplification; an explicit
// active-organization switcher is Phase 1+ scope.
//
// Session 16: extracted out of createContext so the attachment upload/
// download Route Handlers (the first non-tRPC authenticated routes in this
// codebase — multipart file bodies have no tRPC transport) can resolve the
// same userId/organizationId the exact same way, without a second copy of
// this logic drifting out of sync with tRPC's.
export async function resolveSessionContext() {
  const session = await getServerSession(authOptions);

  let userId: string | undefined;
  let organizationId: string | undefined;

  if (session?.user?.id) {
    userId = session.user.id;
    const membership = await prisma.membership.findFirst({ where: { userId } });
    organizationId = membership?.organizationId;
  }

  return { session, userId, organizationId };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by fetchRequestHandler's createContext signature
export async function createContext(_opts: FetchCreateContextFnOptions) {
  const { session, userId, organizationId } = await resolveSessionContext();
  return { prisma, session, userId, organizationId };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
