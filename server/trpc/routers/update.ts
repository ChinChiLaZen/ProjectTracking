import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { requireBoardAccess } from "../../../lib/permissions/requireBoardAccess";
import { meetsMinRole } from "../../../lib/permissions/matrix";
import { createUpdate, deleteUpdate, listUpdates } from "../../services/updates";

export const updateRouter = router({
  create: protectedProcedure
    .input(z.object({ boardId: z.string(), itemId: z.string(), body: z.string().trim().min(1).max(5000) }))
    .mutation(async ({ ctx, input }) => {
      await requireBoardAccess(ctx, input.boardId, "GUEST"); // item.edit (§5) — "create/edit/move items, comment"
      return createUpdate({
        organizationId: ctx.organizationId,
        boardId: input.boardId,
        itemId: input.itemId,
        authorId: ctx.userId,
        body: input.body,
      });
    }),

  list: protectedProcedure
    .input(z.object({ boardId: z.string(), itemId: z.string(), cursor: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }))
    .query(async ({ ctx, input }) => {
      await requireBoardAccess(ctx, input.boardId, "GUEST"); // board.read (§5)
      return listUpdates({
        organizationId: ctx.organizationId,
        boardId: input.boardId,
        itemId: input.itemId,
        cursor: input.cursor,
        limit: input.limit,
      });
    }),

  // Fine-grained permission (creator-or-ADMIN) lives in the service —
  // identical shape to view.ts's delete procedure.
  delete: protectedProcedure
    .input(z.object({ boardId: z.string(), updateId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { role } = await requireBoardAccess(ctx, input.boardId, "GUEST");
      return deleteUpdate({
        organizationId: ctx.organizationId,
        boardId: input.boardId,
        updateId: input.updateId,
        callerId: ctx.userId,
        callerIsAdmin: meetsMinRole(role, "ADMIN"),
      });
    }),
});
