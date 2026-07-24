import { TRPCError } from "@trpc/server";
import { prisma } from "../db/client";
import { runWithTenant } from "../db/tenantContext";
import { firstRank, isValidRank, rankAfter } from "../../lib/ordering/rank";
import { compileViewConfig } from "../../lib/views/compileQuery";
import { columnTypeRegistry } from "../../lib/columnTypes/registry";
import { writeColumnValueInTx } from "./columnValues";
import type { ViewConfig } from "../../lib/views/viewConfig";
import type { Prisma } from "../../generated/prisma/client";

export type BoardColumnValue = {
  itemId: string;
  columnId: string;
  // Erased to `unknown` on purpose: Prisma's recursive JsonValue type,
  // carried through tRPC + react-query's generics, blows up TS ("type
  // instantiation is excessively deep") — see the Session 2 decision log.
  value: unknown;
  version: number;
};

function trimValues(rawValues: Array<{ itemId: string; columnId: string; value: unknown; version: number }>): BoardColumnValue[] {
  return rawValues.map((v) => ({ itemId: v.itemId, columnId: v.columnId, value: v.value, version: v.version }));
}

export async function createItem(params: {
  organizationId: string;
  boardId: string;
  groupId: string;
  name: string;
  actorId: string;
}) {
  const { organizationId, boardId, groupId, name, actorId } = params;

  return runWithTenant(organizationId, () =>
    prisma.$transaction(async (tx) => {
      // Lock the board row as a per-board serialization point so concurrent
      // item creates on the same board don't race on `number` (§4.2). A
      // Postgres SELECT ... FOR UPDATE can't target an aggregate directly,
      // so the board row stands in as the mutex. Fine at this scale — the
      // 10k-item/perf work is Session 4's job, not this one.
      await tx.$queryRaw`SELECT id FROM boards WHERE id = ${boardId} FOR UPDATE`;

      const [lastItemInGroup, maxNumber] = await Promise.all([
        tx.item.findFirst({ where: { groupId, organizationId }, orderBy: { rank: "desc" } }),
        tx.item.aggregate({ where: { boardId, organizationId }, _max: { number: true } }),
      ]);

      const rank = lastItemInGroup ? rankAfter(lastItemInGroup.rank) : firstRank();
      const number = (maxNumber._max.number ?? 0) + 1;

      const item = await tx.item.create({
        data: { organizationId, boardId, groupId, name, rank, number },
      });

      await tx.activityLog.create({
        data: {
          organizationId,
          boardId,
          itemId: item.id,
          actorType: "USER",
          actorId,
          type: "item.created",
          payload: { name, number },
        },
      });

      await tx.outboxEvent.create({
        data: {
          organizationId,
          boardId,
          itemId: item.id,
          type: "item.created",
          payload: { name, number },
          actorType: "USER",
          actorId,
          depth: 0,
          causedByAutomationIds: [],
        },
      });

      return item;
    }),
  );
}

// Drag-to-reorder (§10.1 Session 3 gate: exactly one row updated). `groupId`
// is accepted generically — the Table view only drives same-group
// reordering today, but a future cross-group drag needs no service change.
export async function moveItem(params: {
  organizationId: string;
  boardId: string;
  itemId: string;
  groupId: string;
  rank: string;
  expectedVersion: number;
  actorId: string;
}) {
  const { organizationId, boardId, itemId, groupId, rank, expectedVersion, actorId } = params;

  if (!isValidRank(rank)) {
    // Not just cosmetic — a malformed stored rank crashes the next
    // rankAfter/rankBetween call against it (e.g. a sibling insert).
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid rank" });
  }

  return runWithTenant(organizationId, () =>
    prisma.$transaction(async (tx) => {
      const item = await tx.item.findFirst({ where: { id: itemId, boardId, organizationId } });
      if (!item) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // §4.2: same optimistic-concurrency contract as setColumnValue.
      if (item.version !== expectedVersion) {
        throw new TRPCError({ code: "CONFLICT" });
      }

      const updated = await tx.item.update({
        where: { id: itemId, organizationId },
        data: { groupId, rank, version: { increment: 1 } },
      });

      await tx.activityLog.create({
        data: {
          organizationId,
          boardId,
          itemId,
          actorType: "USER",
          actorId,
          type: "item.moved",
          payload: { fromGroupId: item.groupId, toGroupId: groupId, rank },
        },
      });

      await tx.outboxEvent.create({
        data: {
          organizationId,
          boardId,
          itemId,
          type: "item.moved",
          payload: { fromGroupId: item.groupId, toGroupId: groupId, rank },
          actorType: "USER",
          actorId,
          depth: 0,
          causedByAutomationIds: [],
        },
      });

      return updated;
    }),
  );
}

// Kanban drag (§6/§10.1 Session 9): "one setColumnValue + one rank update
// in a single transaction" — a card moving between Kanban buckets changes
// both its rank (append to the end of the target bucket) and the grouping
// column's value (e.g. status). Combining them into one transaction is the
// whole point: two separate round trips could leave a card silently
// misplaced if the second one failed. Never changes the item's real board
// Group (Kanban buckets are a display-layer grouping within a Group, not
// the Group itself) — accepts no groupId, unlike moveItem.
export async function moveKanbanItem(params: {
  organizationId: string;
  boardId: string;
  itemId: string;
  rank: string;
  expectedItemVersion: number;
  columnId: string;
  value: unknown;
  expectedColumnVersion: number;
  actorId: string;
}) {
  const { organizationId, boardId, itemId, rank, expectedItemVersion, columnId, value, expectedColumnVersion, actorId } =
    params;

  if (!isValidRank(rank)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid rank" });
  }

  return runWithTenant(organizationId, () =>
    prisma.$transaction(async (tx) => {
      const item = await tx.item.findFirst({ where: { id: itemId, boardId, organizationId } });
      if (!item) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (item.version !== expectedItemVersion) {
        throw new TRPCError({ code: "CONFLICT" });
      }

      const updatedItem = await tx.item.update({
        where: { id: itemId, organizationId },
        data: { rank, version: { increment: 1 } },
      });

      await tx.activityLog.create({
        data: {
          organizationId,
          boardId,
          itemId,
          actorType: "USER",
          actorId,
          type: "item.moved",
          payload: { rank },
        },
      });

      await tx.outboxEvent.create({
        data: {
          organizationId,
          boardId,
          itemId,
          type: "item.moved",
          payload: { rank },
          actorType: "USER",
          actorId,
          depth: 0,
          causedByAutomationIds: [],
        },
      });

      // Same validate+shadow-project+version-check+upsert+log logic
      // setColumnValue uses standalone — reused here so both writes commit
      // or roll back together (§4.2/§7's version-conflict semantics stay
      // identical for a Kanban drag as for a direct cell edit; only the
      // caller's transaction boundary is wider).
      const columnValue = await writeColumnValueInTx(tx, {
        organizationId,
        boardId,
        itemId,
        columnId,
        value,
        expectedVersion: expectedColumnVersion,
        actorId,
      });

      return { item: updatedItem, columnValue };
    }),
  );
}

// Session 4: cursor-paginated, filtered, sorted item listing for one group
// (§6 "cursor-based, per group, default 50 items with load more"). Two
// query shapes depending on whether an explicit column sort is requested —
// see lib/views/compileQuery.ts's module comment for why.
export async function listItemsInGroup(params: {
  organizationId: string;
  boardId: string;
  groupId: string;
  viewConfig: ViewConfig;
  cursor?: string;
  limit?: number;
}) {
  const { organizationId, boardId, groupId, viewConfig } = params;
  const limit = params.limit ?? 50;

  return runWithTenant(organizationId, async () => {
    const columns = await prisma.columnDefinition.findMany({ where: { boardId, organizationId } });
    const { itemWhere, sort } = compileViewConfig(viewConfig, columns, columnTypeRegistry);

    // organizationId stays top-level (not nested inside AND) so the
    // tenant-scoping extension's defense-in-depth check on Item still sees it.
    const scopedWhere: Prisma.ItemWhereInput = {
      boardId,
      groupId,
      organizationId,
      ...(itemWhere.AND ? { AND: itemWhere.AND } : {}),
    };

    if (!sort) {
      const rows = await prisma.item.findMany({
        where: scopedWhere,
        orderBy: [{ rank: "asc" }, { id: "asc" }],
        take: limit + 1,
        ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      });

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const values = await prisma.columnValue.findMany({
        where: { itemId: { in: items.map((i) => i.id) }, organizationId },
      });

      return { items, values: trimValues(values), nextCursor: hasMore ? items[items.length - 1]!.id : null };
    }

    // Sort-by-column: root the query at ColumnValue for the sort column —
    // Prisma can't order a to-many relation by a filtered related record's
    // field, and this hits the (boardId, columnId, shadowField) index directly.
    const rows = await prisma.columnValue.findMany({
      where: { columnId: sort.columnId, organizationId, item: scopedWhere },
      orderBy: [{ [sort.shadowField]: sort.direction }, { itemId: "asc" }],
      take: limit + 1,
      ...(params.cursor
        ? { cursor: { itemId_columnId: { itemId: params.cursor, columnId: sort.columnId } }, skip: 1 }
        : {}),
      include: { item: true },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = page.map((r) => r.item);
    const values = await prisma.columnValue.findMany({
      where: { itemId: { in: items.map((i) => i.id) }, organizationId },
    });

    return { items, values: trimValues(values), nextCursor: hasMore ? page[page.length - 1]!.itemId : null };
  });
}

// Calendar (§6/§10.1 Session 10): "query by date range, never load the
// whole board." Unlike listItemsInGroup, this is boardwide, not scoped to
// one Group — a calendar day cell needs items from every group whose
// chosen date column falls on that day, and Table/Kanban's per-Group
// partition doesn't apply to a date-indexed view. No cursor pagination
// (a rendered month grid is inherently bounded); `limit` is a flat safety
// cap, not a page size, so a pathological all-items-one-day case still
// can't load the whole board.
export async function listItemsInDateRange(params: {
  organizationId: string;
  boardId: string;
  dateColumnId: string;
  rangeStart: Date;
  rangeEnd: Date;
  viewConfig: ViewConfig;
  limit?: number;
}) {
  const { organizationId, boardId, dateColumnId, rangeStart, rangeEnd, viewConfig } = params;
  const limit = params.limit ?? 500;

  return runWithTenant(organizationId, async () => {
    const columns = await prisma.columnDefinition.findMany({ where: { boardId, organizationId } });
    // Only the *other* filters come from compileViewConfig — the date-range
    // condition itself is this query's own, always-present clause below.
    const { itemWhere } = compileViewConfig(viewConfig, columns, columnTypeRegistry);

    // itemWhere.AND may be a single fragment or an array (Prisma's own
    // union for this field) — normalize before appending this query's own
    // always-present date-range condition.
    const otherConditions = itemWhere.AND ? (Array.isArray(itemWhere.AND) ? itemWhere.AND : [itemWhere.AND]) : [];
    const scopedWhere: Prisma.ItemWhereInput = {
      boardId,
      organizationId,
      AND: [
        ...otherConditions,
        { values: { some: { columnId: dateColumnId, organizationId, valueDate: { gte: rangeStart, lte: rangeEnd } } } },
      ],
    };

    const items = await prisma.item.findMany({
      where: scopedWhere,
      orderBy: [{ rank: "asc" }, { id: "asc" }],
      take: limit,
    });

    const values = await prisma.columnValue.findMany({
      where: { itemId: { in: items.map((i) => i.id) }, organizationId },
    });

    return { items, values: trimValues(values) };
  });
}

// §4.2: "Item... carries a version Int bumped on every write" — a rename is
// a write to Item, so it gets the same optimistic-concurrency contract as
// moveItem/setColumnValue, not a last-write-wins shortcut.
export async function renameItem(params: {
  organizationId: string;
  boardId: string;
  itemId: string;
  name: string;
  expectedVersion: number;
  actorId: string;
}) {
  const { organizationId, boardId, itemId, name, expectedVersion, actorId } = params;

  return runWithTenant(organizationId, () =>
    prisma.$transaction(async (tx) => {
      const item = await tx.item.findFirst({ where: { id: itemId, boardId, organizationId } });
      if (!item) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (item.version !== expectedVersion) {
        throw new TRPCError({ code: "CONFLICT" });
      }

      const updated = await tx.item.update({
        where: { id: itemId, organizationId },
        data: { name, version: { increment: 1 } },
      });

      await tx.activityLog.create({
        data: {
          organizationId,
          boardId,
          itemId,
          actorType: "USER",
          actorId,
          type: "item.renamed",
          payload: { from: item.name, to: name },
        },
      });
      await tx.outboxEvent.create({
        data: {
          organizationId,
          boardId,
          itemId,
          type: "item.renamed",
          payload: { from: item.name, to: name },
          actorType: "USER",
          actorId,
          depth: 0,
          causedByAutomationIds: [],
        },
      });

      return updated;
    }),
  );
}

export async function deleteItem(params: { organizationId: string; boardId: string; itemId: string; actorId: string }) {
  const { organizationId, boardId, itemId, actorId } = params;

  return runWithTenant(organizationId, () =>
    prisma.$transaction(async (tx) => {
      const item = await tx.item.findFirst({ where: { id: itemId, boardId, organizationId } });
      if (!item) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const updated = await tx.item.update({ where: { id: itemId, organizationId }, data: { deletedAt: new Date() } });

      await tx.activityLog.create({
        data: { organizationId, boardId, itemId, actorType: "USER", actorId, type: "item.deleted", payload: {} },
      });
      await tx.outboxEvent.create({
        data: {
          organizationId,
          boardId,
          itemId,
          type: "item.deleted",
          payload: {},
          actorType: "USER",
          actorId,
          depth: 0,
          causedByAutomationIds: [],
        },
      });

      return updated;
    }),
  );
}
