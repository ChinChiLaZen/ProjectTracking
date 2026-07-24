import { TRPCError } from "@trpc/server";
import { prisma } from "../db/client";
import { runWithTenant } from "../db/tenantContext";
import { firstRank, isValidRank, rankAfter } from "../../lib/ordering/rank";

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
