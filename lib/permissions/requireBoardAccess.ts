import { TRPCError } from "@trpc/server";
import { prisma } from "../../server/db/client";
import { runWithTenant } from "../../server/db/tenantContext";
import { meetsMinRole, type Role } from "./matrix";

export type BoardAccessContext = {
  userId: string;
  organizationId: string;
};

export async function requireBoardAccess(ctx: BoardAccessContext, boardId: string, minRole: Role) {
  return runWithTenant(ctx.organizationId, async () => {
    const board = await prisma.board.findFirst({
      where: { id: boardId, organizationId: ctx.organizationId },
    });

    // Same failure for "doesn't exist" and "belongs to another org" —
    // never let a caller distinguish the two (§5 anti-probing rule).
    if (!board) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }

    const boardMembership = await prisma.boardMembership.findUnique({
      where: { boardId_userId: { boardId, userId: ctx.userId } },
    });

    let role: Role | undefined = boardMembership?.role as Role | undefined;

    if (!role) {
      const orgMembership = await prisma.membership.findUnique({
        where: { organizationId_userId: { organizationId: ctx.organizationId, userId: ctx.userId } },
      });
      // Guests get no default board access (§5) — only an explicit
      // BoardMembership grants them anything, handled above.
      if (orgMembership && orgMembership.role !== "GUEST") {
        role = orgMembership.role as Role;
      }
    }

    if (!role || !meetsMinRole(role, minRole)) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    return { board, role };
  });
}
