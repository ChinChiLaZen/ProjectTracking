import { TRPCError } from "@trpc/server";
import { prisma } from "../db/client";
import { runWithTenant } from "../db/tenantContext";
import { getColumnType } from "../../lib/columnTypes/types";
import { columnTypeRegistry } from "../../lib/columnTypes/registry";
import type { Prisma } from "../../generated/prisma/client";

// Derived directly from `prisma.$transaction`'s own callback signature
// (rather than a hand-rolled Omit<PrismaClient, ...>) so it stays exactly
// compatible with the tenant-scoping-extended client (server/db/client.ts) —
// the extension's dynamic types don't structurally match a plain
// Prisma.TransactionClient.
type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// The one path through which a cell's value ever changes: validate against
// the registry's valueSchema, derive the shadow projection via the full
// DeriveContext (§4.3 Decision 1), enforce optimistic concurrency, and
// record ActivityLog + OutboxEvent — all in one transaction (§11, §4.2, §7.1).
// Extracted from setColumnValue (Session 9) so a caller that's already
// inside its own transaction — moveKanbanItem, which combines this with a
// rank update — can run the exact same logic instead of duplicating it.
export async function writeColumnValueInTx(
  tx: TxClient,
  params: {
    organizationId: string;
    boardId: string;
    itemId: string;
    columnId: string;
    value: unknown;
    expectedVersion: number;
    actorId: string;
  },
) {
  const { organizationId, boardId, itemId, columnId, value, expectedVersion, actorId } = params;

  // DeriveContext requires the board's timezone and every sibling
  // column/value on the item, even for a type like `text` that ignores
  // them — the shape is uniform so computed types (Phase 6) don't need
  // a second code path later.
  const [board, column, item, boardColumns, itemValues] = await Promise.all([
    tx.board.findFirst({ where: { id: boardId, organizationId } }),
    tx.columnDefinition.findFirst({ where: { id: columnId, boardId, organizationId } }),
    tx.item.findFirst({ where: { id: itemId, boardId, organizationId } }),
    tx.columnDefinition.findMany({ where: { boardId, organizationId } }),
    tx.columnValue.findMany({ where: { itemId, organizationId } }),
  ]);

  if (!board || !column || !item) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  const columnType = getColumnType(columnTypeRegistry, column.key);

  if (columnType.computed) {
    // Decision 5: computed columns are recomputed from their
    // dependencies, never written directly. No column type sets this
    // yet (formula/rollup are Phase 6) — this is what lets the service
    // layer enforce it generically once one does, instead of a
    // hardcoded list of type names.
    throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot write to a computed column" });
  }

  const parsedValue = columnType.valueSchema.parse(value);

  const columnsById: Record<string, { id: string; type: string; settings: unknown }> = {};
  for (const c of boardColumns) {
    columnsById[c.id] = { id: c.id, type: c.key, settings: c.settings };
  }

  const valuesByColumnId: Record<string, unknown> = {};
  for (const v of itemValues) {
    valuesByColumnId[v.columnId] = v.value;
  }

  const shadow = columnType.toShadow({
    value: parsedValue,
    settings: column.settings,
    item: { id: item.id, boardId: item.boardId, groupId: item.groupId },
    valuesByColumnId,
    columnsById,
    timeZone: board.timeZone,
  });

  const existing = itemValues.find((v) => v.columnId === columnId);

  // §4.2: mutations send the version they read; a mismatch means someone
  // else wrote in between — reject rather than silently overwrite.
  const currentVersion = existing?.version ?? 0;
  if (currentVersion !== expectedVersion) {
    throw new TRPCError({ code: "CONFLICT" });
  }

  const columnValue = existing
    ? await tx.columnValue.update({
        where: { itemId_columnId: { itemId, columnId }, organizationId },
        data: { value: parsedValue as Prisma.InputJsonValue, ...shadow, version: { increment: 1 } },
      })
    : await tx.columnValue.create({
        data: {
          itemId,
          columnId,
          organizationId,
          boardId,
          value: parsedValue as Prisma.InputJsonValue,
          ...shadow,
          version: 1,
        },
      });

  await tx.activityLog.create({
    data: {
      organizationId,
      boardId,
      itemId,
      actorType: "USER",
      actorId,
      type: "item.column_changed",
      payload: {
        columnId,
        previousValue: (existing?.value ?? null) as Prisma.InputJsonValue,
        value: parsedValue as Prisma.InputJsonValue,
      },
    },
  });

  await tx.outboxEvent.create({
    data: {
      organizationId,
      boardId,
      itemId,
      type: "item.column_changed",
      payload: {
        columnId,
        previousValue: (existing?.value ?? null) as Prisma.InputJsonValue,
        value: parsedValue as Prisma.InputJsonValue,
      },
      actorType: "USER",
      actorId,
      depth: 0,
      causedByAutomationIds: [],
    },
  });

  return columnValue;
}

export async function setColumnValue(params: {
  organizationId: string;
  boardId: string;
  itemId: string;
  columnId: string;
  value: unknown;
  expectedVersion: number;
  actorId: string;
}) {
  const { organizationId, ...rest } = params;
  return runWithTenant(organizationId, () =>
    prisma.$transaction((tx) => writeColumnValueInTx(tx, { organizationId, ...rest })),
  );
}
