import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { requireBoardAccess } from "../../../lib/permissions/requireBoardAccess";
import { listActivity } from "../../services/activityLog";

export const activityRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        boardId: z.string(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireBoardAccess(ctx, input.boardId, "GUEST"); // board.read (§5)
      return listActivity({
        organizationId: ctx.organizationId,
        boardId: input.boardId,
        cursor: input.cursor,
        limit: input.limit,
      });
    }),
});
