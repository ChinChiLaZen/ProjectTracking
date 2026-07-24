import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { requireBoardAccess } from "../../../lib/permissions/requireBoardAccess";
import { requireOrgRole } from "../../../lib/permissions/requireOrgRole";
import { createBoard, deleteBoard, getBoardShell, renameBoard } from "../../services/boards";

export const boardRouter = router({
  // Session 4: shell only (board + groups + columns) — no items/values.
  // Those are paginated per group via item.list.
  get: protectedProcedure.input(z.object({ boardId: z.string() })).query(async ({ ctx, input }) => {
    await requireBoardAccess(ctx, input.boardId, "GUEST"); // board.read (§5)
    return getBoardShell(ctx.organizationId, input.boardId);
  }),

  create: protectedProcedure
    .input(z.object({ workspaceId: z.string(), name: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireOrgRole(ctx, "ADMIN"); // board.manage (§5) — no board exists yet to check board-level role against
      const { board } = await createBoard({
        organizationId: ctx.organizationId,
        workspaceId: input.workspaceId,
        name: input.name,
        actorId: ctx.userId,
      });
      return board;
    }),

  rename: protectedProcedure
    .input(z.object({ boardId: z.string(), name: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireBoardAccess(ctx, input.boardId, "ADMIN"); // board.manage (§5)
      return renameBoard({
        organizationId: ctx.organizationId,
        boardId: input.boardId,
        name: input.name,
        actorId: ctx.userId,
      });
    }),

  delete: protectedProcedure.input(z.object({ boardId: z.string() })).mutation(async ({ ctx, input }) => {
    await requireBoardAccess(ctx, input.boardId, "ADMIN"); // board.manage (§5)
    return deleteBoard({ organizationId: ctx.organizationId, boardId: input.boardId, actorId: ctx.userId });
  }),
});
