import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { requireBoardAccess } from "../../../lib/permissions/requireBoardAccess";
import { getBoardData } from "../../services/boards";

export const boardRouter = router({
  get: protectedProcedure.input(z.object({ boardId: z.string() })).query(async ({ ctx, input }) => {
    await requireBoardAccess(ctx, input.boardId, "GUEST"); // board.read (§5)
    return getBoardData(ctx.organizationId, input.boardId);
  }),
});
