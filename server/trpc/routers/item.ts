import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { requireBoardAccess } from "../../../lib/permissions/requireBoardAccess";
import { createItem } from "../../services/items";
import { setColumnValue } from "../../services/columnValues";

export const itemRouter = router({
  create: protectedProcedure
    .input(z.object({ boardId: z.string(), groupId: z.string(), name: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireBoardAccess(ctx, input.boardId, "GUEST"); // item.edit (§5)
      return createItem({
        organizationId: ctx.organizationId,
        boardId: input.boardId,
        groupId: input.groupId,
        name: input.name,
        actorId: ctx.userId,
      });
    }),

  setColumnValue: protectedProcedure
    .input(
      z.object({
        boardId: z.string(),
        itemId: z.string(),
        columnId: z.string(),
        value: z.unknown(),
        // §4.2 optimistic concurrency: the client sends the version it read;
        // 0 means "no ColumnValue row exists yet."
        expectedVersion: z.number().int().nonnegative(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireBoardAccess(ctx, input.boardId, "GUEST"); // item.edit (§5)
      const columnValue = await setColumnValue({
        organizationId: ctx.organizationId,
        boardId: input.boardId,
        itemId: input.itemId,
        columnId: input.columnId,
        value: input.value,
        expectedVersion: input.expectedVersion,
        actorId: ctx.userId,
      });

      // Trimmed to match BoardColumnValue — the client never needs shadow
      // columns, and returning Prisma's raw Json-typed row here blows up
      // TS's inference through useMutation's optimistic-update generics.
      const value: unknown = columnValue.value;
      return { itemId: columnValue.itemId, columnId: columnValue.columnId, value, version: columnValue.version };
    }),
});
