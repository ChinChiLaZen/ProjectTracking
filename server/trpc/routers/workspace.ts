import { router, protectedProcedure } from "../trpc";
import { runWithTenant } from "../../db/tenantContext";
import { getOrgRole } from "../../../lib/permissions/requireOrgRole";

export const workspaceRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const role = await getOrgRole(ctx);
    // §5: "Guests never see the workspace sidebar or cross-board
    // dashboards" — a GUEST (or someone with no org membership at all)
    // gets an empty list, not an error (this isn't a rejected request,
    // just an empty one — matches how a guest's UI should render).
    if (!role || role === "GUEST") {
      return [];
    }

    return runWithTenant(ctx.organizationId, () =>
      ctx.prisma.workspace.findMany({ where: { organizationId: ctx.organizationId } }),
    );
  }),
});
