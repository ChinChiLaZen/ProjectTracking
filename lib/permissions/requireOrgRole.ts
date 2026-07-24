import { TRPCError } from "@trpc/server";
import { prisma } from "../../server/db/client";
import { runWithTenant } from "../../server/db/tenantContext";
import { meetsMinRole, type Role } from "./matrix";

export type OrgAccessContext = {
  userId: string;
  organizationId: string;
};

// Non-throwing — for callers that need to branch on role (e.g. workspace.list
// returning [] for a GUEST) rather than reject the whole request.
export async function getOrgRole(ctx: OrgAccessContext): Promise<Role | undefined> {
  return runWithTenant(ctx.organizationId, async () => {
    const membership = await prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId: ctx.organizationId, userId: ctx.userId } },
    });
    return membership?.role as Role | undefined;
  });
}

// For actions with no board yet to check board-level role against (e.g.
// board.create, §5: "Create/delete boards... Owner/Admin").
export async function requireOrgRole(ctx: OrgAccessContext, minRole: Role): Promise<Role> {
  const role = await getOrgRole(ctx);
  if (!role || !meetsMinRole(role, minRole)) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return role;
}
