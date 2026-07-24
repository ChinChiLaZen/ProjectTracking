import { NextResponse } from "next/server";
import { TRPCError } from "@trpc/server";
import { resolveSessionContext } from "../trpc/context";
import { requireBoardAccess } from "../../lib/permissions/requireBoardAccess";
import type { Role } from "../../lib/permissions/matrix";

export type AuthorizedRequest = { userId: string; organizationId: string };

// Session 16: the attachment upload/download Route Handlers are the first
// non-tRPC authenticated routes in this codebase — no `protectedProcedure`
// middleware or `requireBoardAccess`-wrapping router exists for them to
// inherit. This is that missing piece, factored out once (not duplicated
// across the two routes that need it) — resolves the session the same way
// resolveSessionContext/createContext do, then runs the identical
// requireBoardAccess check every tRPC procedure already uses, mapping its
// thrown TRPCError to the equivalent HTTP status.
export async function authorizeBoardRequest(
  boardId: string,
  minRole: Role = "GUEST",
): Promise<{ ok: true; ctx: AuthorizedRequest } | { ok: false; response: NextResponse }> {
  const { userId, organizationId } = await resolveSessionContext();
  if (!userId || !organizationId) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  try {
    await requireBoardAccess({ userId, organizationId }, boardId, minRole);
    return { ok: true, ctx: { userId, organizationId } };
  } catch (err) {
    if (err instanceof TRPCError) {
      const status = err.code === "NOT_FOUND" ? 404 : err.code === "FORBIDDEN" ? 403 : 500;
      return { ok: false, response: NextResponse.json({ error: err.message || err.code }, { status }) };
    }
    throw err;
  }
}
