import { router, protectedProcedure } from "../trpc";
import { runWithTenant } from "../../db/tenantContext";

// Minimal placeholder procedure proving the session -> context -> tenancy
// middleware -> Prisma wiring end to end. Real Workspace CRUD is Phase 1+.
export const workspaceRouter = router({
  list: protectedProcedure.query(({ ctx }) => {
    return runWithTenant(ctx.organizationId, () =>
      ctx.prisma.workspace.findMany({ where: { organizationId: ctx.organizationId } }),
    );
  }),
});
