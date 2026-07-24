import { TRPCError } from "@trpc/server";
import { prisma } from "../db/client";
import { runWithTenant } from "../db/tenantContext";
import { viewConfigSchema } from "../../lib/views/viewConfig";
import type { Prisma } from "../../generated/prisma/client";

export async function createView(params: {
  organizationId: string;
  boardId: string;
  name: string;
  visibility: "SHARED" | "PERSONAL";
  config: unknown;
  creatorId: string;
}) {
  const { organizationId, boardId, name, visibility, creatorId } = params;
  // Same validation path ColumnDefinition.settings goes through — the
  // service, not the router, owns "is this actually a valid viewConfig."
  const config = viewConfigSchema.parse(params.config);

  return runWithTenant(organizationId, () =>
    prisma.view.create({
      data: { organizationId, boardId, name, visibility, creatorId, config: config as Prisma.InputJsonValue },
    }),
  );
}

// Shared views + the caller's own personal ones — nobody sees someone
// else's personal view in a list.
export async function listViews(params: { organizationId: string; boardId: string; callerId: string }) {
  const { organizationId, boardId, callerId } = params;

  return runWithTenant(organizationId, () =>
    prisma.view.findMany({
      where: {
        boardId,
        organizationId,
        OR: [{ visibility: "SHARED" }, { visibility: "PERSONAL", creatorId: callerId }],
      },
      orderBy: { createdAt: "asc" },
    }),
  );
}

export async function getView(params: { organizationId: string; boardId: string; viewId: string; callerId: string }) {
  const { organizationId, boardId, viewId, callerId } = params;

  return runWithTenant(organizationId, async () => {
    const view = await prisma.view.findFirst({ where: { id: viewId, boardId, organizationId } });
    // Same anti-probing shape as requireBoardAccess: a personal view that
    // belongs to someone else 404s rather than 403ing — never let a caller
    // distinguish "doesn't exist" from "exists but isn't yours."
    if (!view || (view.visibility === "PERSONAL" && view.creatorId !== callerId)) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    return view;
  });
}

// Creator can always delete their own view; ADMIN can delete any view on
// the board (shared or someone else's personal one) — board-config cleanup,
// not a privacy grant (getView/listViews still hide personal views from
// non-creators, admins included).
export async function deleteView(params: {
  organizationId: string;
  boardId: string;
  viewId: string;
  callerId: string;
  callerIsAdmin: boolean;
}) {
  const { organizationId, boardId, viewId, callerId, callerIsAdmin } = params;

  return runWithTenant(organizationId, async () => {
    const view = await prisma.view.findFirst({ where: { id: viewId, boardId, organizationId } });
    if (!view) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    if (view.creatorId !== callerId && !callerIsAdmin) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    return prisma.view.update({ where: { id: viewId, organizationId }, data: { deletedAt: new Date() } });
  });
}
