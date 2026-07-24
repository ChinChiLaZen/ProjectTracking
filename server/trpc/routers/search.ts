import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { searchWorkspace } from "../../services/search";

export const searchRouter = router({
  // No requireBoardAccess gate here — which boards apply isn't known until
  // after the query matches rows. The service checks access once per
  // distinct matched board (§6.1).
  global: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        query: z.string(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return searchWorkspace({
        organizationId: ctx.organizationId,
        workspaceId: input.workspaceId,
        callerId: ctx.userId,
        query: input.query,
        limit: input.limit,
      });
    }),
});
