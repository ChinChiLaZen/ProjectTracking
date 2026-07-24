import { TRPCError } from "@trpc/server";
import { prisma } from "../db/client";
import { runWithTenant } from "../db/tenantContext";
import { firstRank, isValidRank, rankAfter } from "../../lib/ordering/rank";
import { compileViewConfig } from "../../lib/views/compileQuery";
import { columnTypeRegistry } from "../../lib/columnTypes/registry";
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
