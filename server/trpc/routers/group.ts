import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { requireBoardAccess } from "../../../lib/permissions/requireBoardAccess";
import { createGroup } from "../../services/groups";

export const groupRouter = router({
  create: protectedProcedure
    .input(z.object({ boardId: z.string(), name: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // §5 doesn't list group creation explicitly; treating it as everyday
      // board usage (item.edit-level, any board member) rather than a
      // structural change (board.editStructure, ADMIN+) like columns.
      await requireBoardAccess(ctx, input.boardId, "GUEST");
      return createGroup({
        organizationId: ctx.organizationId,
        boardId: input.boardId,
        name: input.name,
        actorId: ctx.userId,
      });
    }),
});
