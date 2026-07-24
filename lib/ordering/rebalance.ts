import { generateNKeysBetween } from "fractional-indexing";
import { prisma } from "../../server/db/client";
import { runWithTenant } from "../../server/db/tenantContext";

export type RebalanceScope = { type: "itemsInGroup"; groupId: string } | { type: "groupsInBoard"; boardId: string };

// The rare-precision-blow-out maintenance job §13/§4.2 call for: re-derive
// fresh, evenly-spaced short ranks for every row in scope, in current sort
// order, in one transaction. A plain callable function — no BullMQ/worker
// exists yet (Phase 4), so nothing schedules this automatically today;
// same deferral already applied to OutboxEvent in Session 1.
export async function rebalanceRanks(params: { organizationId: string; scope: RebalanceScope }) {
  const { organizationId, scope } = params;

  return runWithTenant(organizationId, () =>
    prisma.$transaction(async (tx) => {
      if (scope.type === "itemsInGroup") {
        const items = await tx.item.findMany({
          where: { groupId: scope.groupId, organizationId },
          orderBy: { rank: "asc" },
        });
        const freshRanks = generateNKeysBetween(null, null, items.length);
        await Promise.all(
          items.map((item, i) =>
            tx.item.update({ where: { id: item.id, organizationId }, data: { rank: freshRanks[i] } }),
          ),
        );
        return { count: items.length };
      }

      const groups = await tx.group.findMany({
        where: { boardId: scope.boardId, organizationId },
        orderBy: { rank: "asc" },
      });
      const freshRanks = generateNKeysBetween(null, null, groups.length);
      await Promise.all(
        groups.map((group, i) =>
          tx.group.update({ where: { id: group.id, organizationId }, data: { rank: freshRanks[i] } }),
        ),
      );
      return { count: groups.length };
    }),
  );
}
