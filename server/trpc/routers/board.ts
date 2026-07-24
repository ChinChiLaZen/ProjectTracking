import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { requireBoardAccess } from "../../../lib/permissions/requireBoardAccess";
import { getBoardShell } from "../../services/boards";

export const boardRouter = router({
  // Session 4: shell only (board + groups + columns) — no items/values.
  // Those are paginated per group via item.list.
  get: protectedProcedure.input(z.object({ boardId: z.string() })).query(async ({ ctx, input }) => {
    await requireBoardAccess(ctx, input.boardId, "GUEST"); // board.read (§5)
    return getBoardShell(ctx.organizationId, input.boardId);
  }),
});
