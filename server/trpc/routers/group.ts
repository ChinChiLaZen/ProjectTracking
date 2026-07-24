import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { requireBoardAccess } from "../../../lib/permissions/requireBoardAccess";
import { createGroup, deleteGroup, moveGroup, renameGroup } from "../../services/groups";

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

  move: protectedProcedure
    .input(z.object({ boardId: z.string(), groupId: z.string(), rank: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireBoardAccess(ctx, input.boardId, "GUEST"); // same level as group.create
      return moveGroup({
        organizationId: ctx.organizationId,
        boardId: input.boardId,
        groupId: input.groupId,
        rank: input.rank,
        actorId: ctx.userId,
      });
    }),

  rename: protectedProcedure
    .input(z.object({ boardId: z.string(), groupId: z.string(), name: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireBoardAccess(ctx, input.boardId, "GUEST"); // same level as group.create
      return renameGroup({
        organizationId: ctx.organizationId,
        boardId: input.boardId,
        groupId: input.groupId,
        name: input.name,
        actorId: ctx.userId,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ boardId: z.string(), groupId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // ADMIN, not GUEST like create/rename — this cascades (soft-deletes
      // every item in the group), materially more destructive.
      await requireBoardAccess(ctx, input.boardId, "ADMIN");
      return deleteGroup({
        organizationId: ctx.organizationId,
        boardId: input.boardId,
        groupId: input.groupId,
        actorId: ctx.userId,
      });
    }),
});
