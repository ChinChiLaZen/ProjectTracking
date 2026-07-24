import { prisma } from "../db/client";
import { runWithTenant } from "../db/tenantContext";
import { firstRank, rankAfter } from "../../lib/ordering/rank";

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
