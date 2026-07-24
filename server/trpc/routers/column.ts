import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { requireBoardAccess } from "../../../lib/permissions/requireBoardAccess";
import { createColumnDefinition, deleteColumnDefinition, renameColumnDefinition } from "../../services/columnDefinitions";

export const columnRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        boardId: z.string(),
        key: z.string(),
        name: z.string().trim().min(1),
        settings: z.unknown().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireBoardAccess(ctx, input.boardId, "ADMIN"); // board.editStructure (§5)
      return createColumnDefinition({
        organizationId: ctx.organizationId,
        boardId: input.boardId,
        key: input.key,
        name: input.name,
        settings: input.settings,
      });
    }),

  rename: protectedProcedure
    .input(z.object({ boardId: z.string(), columnId: z.string(), name: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireBoardAccess(ctx, input.boardId, "ADMIN"); // board.editStructure (§5)
      return renameColumnDefinition({
        organizationId: ctx.organizationId,
        boardId: input.boardId,
        columnId: input.columnId,
        name: input.name,
        actorId: ctx.userId,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ boardId: z.string(), columnId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireBoardAccess(ctx, input.boardId, "ADMIN"); // board.editStructure (§5)
      return deleteColumnDefinition({
        organizationId: ctx.organizationId,
        boardId: input.boardId,
        columnId: input.columnId,
        actorId: ctx.userId,
      });
    }),
});
