import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { requireBoardAccess } from "../../../lib/permissions/requireBoardAccess";
import { createItem, deleteItem, listItemsInGroup, moveItem, moveKanbanItem, renameItem } from "../../services/items";
import { setColumnValue } from "../../services/columnValues";
import { defaultViewConfig, viewConfigSchema } from "../../../lib/views/viewConfig";

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

  move: protectedProcedure
    .input(
      z.object({
        boardId: z.string(),
        itemId: z.string(),
        groupId: z.string(),
        rank: z.string().min(1),
        expectedVersion: z.number().int().nonnegative(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireBoardAccess(ctx, input.boardId, "GUEST"); // item.edit (§5)
      return moveItem({
        organizationId: ctx.organizationId,
        boardId: input.boardId,
        itemId: input.itemId,
        groupId: input.groupId,
        rank: input.rank,
        expectedVersion: input.expectedVersion,
        actorId: ctx.userId,
      });
    }),

  // Session 9: Kanban drag — one rank update + one setColumnValue in a
  // single transaction (§6/§7). Never changes the item's real board Group.
  moveKanban: protectedProcedure
    .input(
      z.object({
        boardId: z.string(),
        itemId: z.string(),
        rank: z.string().min(1),
        expectedItemVersion: z.number().int().nonnegative(),
        columnId: z.string(),
        value: z.unknown(),
        expectedColumnVersion: z.number().int().nonnegative(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireBoardAccess(ctx, input.boardId, "GUEST"); // item.edit (§5)
      const result = await moveKanbanItem({
        organizationId: ctx.organizationId,
        boardId: input.boardId,
        itemId: input.itemId,
        rank: input.rank,
        expectedItemVersion: input.expectedItemVersion,
        columnId: input.columnId,
        value: input.value,
        expectedColumnVersion: input.expectedColumnVersion,
        actorId: ctx.userId,
      });

      // Trimmed to match BoardColumnValue — same "Json field through
      // react-query generics" reasoning as setColumnValue's return above.
      const value: unknown = result.columnValue.value;
      return {
        item: result.item,
        columnValue: { itemId: result.columnValue.itemId, columnId: result.columnValue.columnId, value, version: result.columnValue.version },
      };
    }),

  // Session 4: cursor-paginated, filtered/sorted item list for one group
  // (§6 "cursor-based, per group, default 50 items with load more").
  list: protectedProcedure
    .input(
      z.object({
        boardId: z.string(),
        groupId: z.string(),
        viewConfig: viewConfigSchema.optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireBoardAccess(ctx, input.boardId, "GUEST"); // board.read (§5)
      return listItemsInGroup({
        organizationId: ctx.organizationId,
        boardId: input.boardId,
        groupId: input.groupId,
        viewConfig: input.viewConfig ?? defaultViewConfig,
        cursor: input.cursor,
        limit: input.limit,
      });
    }),

  rename: protectedProcedure
    .input(
      z.object({
        boardId: z.string(),
        itemId: z.string(),
        name: z.string().trim().min(1),
        expectedVersion: z.number().int().nonnegative(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireBoardAccess(ctx, input.boardId, "GUEST"); // item.edit (§5)
      return renameItem({
        organizationId: ctx.organizationId,
        boardId: input.boardId,
        itemId: input.itemId,
        name: input.name,
        expectedVersion: input.expectedVersion,
        actorId: ctx.userId,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ boardId: z.string(), itemId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireBoardAccess(ctx, input.boardId, "GUEST"); // item.edit (§5)
      return deleteItem({
        organizationId: ctx.organizationId,
        boardId: input.boardId,
        itemId: input.itemId,
        actorId: ctx.userId,
      });
    }),
});
