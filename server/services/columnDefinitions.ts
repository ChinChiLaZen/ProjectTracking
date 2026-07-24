import { TRPCError } from "@trpc/server";
import { prisma } from "../db/client";
import { runWithTenant } from "../db/tenantContext";
import { firstRank, rankAfter } from "../../lib/ordering/rank";
import { getColumnType } from "../../lib/columnTypes/types";
import { columnTypeRegistry } from "../../lib/columnTypes/registry";
import type { Prisma } from "../../generated/prisma/client";

export async function createColumnDefinition(params: {
  organizationId: string;
  boardId: string;
  key: string;
  name: string;
  settings?: unknown;
}) {
  const { organizationId, boardId, key, name } = params;
  const columnType = getColumnType(columnTypeRegistry, key);
  const settings = columnType.settingsSchema.parse(params.settings ?? {});

  return runWithTenant(organizationId, async () => {
    const last = await prisma.columnDefinition.findFirst({
      where: { boardId, organizationId },
      orderBy: { rank: "desc" },
    });
    const rank = last ? rankAfter(last.rank) : firstRank();

    return prisma.columnDefinition.create({
      data: { organizationId, boardId, key, name, settings: settings as Prisma.InputJsonValue, rank },
    });
  });
}

export async function renameColumnDefinition(params: {
  organizationId: string;
  boardId: string;
  columnId: string;
  name: string;
  actorId: string;
}) {
  const { organizationId, boardId, columnId, name, actorId } = params;

  return runWithTenant(organizationId, () =>
    prisma.$transaction(async (tx) => {
      const column = await tx.columnDefinition.findFirst({ where: { id: columnId, boardId, organizationId } });
      if (!column) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const updated = await tx.columnDefinition.update({ where: { id: columnId, organizationId }, data: { name } });

      // createColumnDefinition doesn't write ActivityLog/OutboxEvent (a
      // Session 2 scope call) — rename/delete do, matching the broader
      // mutation pattern; a minor inconsistency with create, not fixed here.
      await tx.activityLog.create({
        data: {
          organizationId,
          boardId,
          actorType: "USER",
          actorId,
          type: "column.renamed",
          payload: { columnId, from: column.name, to: name },
        },
      });
      await tx.outboxEvent.create({
        data: {
          organizationId,
          boardId,
          type: "column.renamed",
          payload: { columnId, from: column.name, to: name },
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

export async function deleteColumnDefinition(params: {
  organizationId: string;
  boardId: string;
  columnId: string;
  actorId: string;
}) {
  const { organizationId, boardId, columnId, actorId } = params;

  return runWithTenant(organizationId, () =>
    prisma.$transaction(async (tx) => {
      const column = await tx.columnDefinition.findFirst({ where: { id: columnId, boardId, organizationId } });
      if (!column) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const updated = await tx.columnDefinition.update({
        where: { id: columnId, organizationId },
        data: { deletedAt: new Date() },
      });

      await tx.activityLog.create({
        data: {
          organizationId,
          boardId,
          actorType: "USER",
          actorId,
          type: "column.deleted",
          payload: { columnId },
        },
      });
      await tx.outboxEvent.create({
        data: {
          organizationId,
          boardId,
          type: "column.deleted",
          payload: { columnId },
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
