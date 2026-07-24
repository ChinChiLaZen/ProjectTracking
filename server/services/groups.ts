import { prisma } from "../db/client";
import { runWithTenant } from "../db/tenantContext";
import { firstRank, rankAfter } from "../../lib/ordering/rank";

export async function createGroup(params: {
  organizationId: string;
  boardId: string;
  name: string;
  actorId: string;
}) {
  const { organizationId, boardId, name, actorId } = params;

  return runWithTenant(organizationId, () =>
    prisma.$transaction(async (tx) => {
      const last = await tx.group.findFirst({
        where: { boardId, organizationId },
        orderBy: { rank: "desc" },
      });
      const rank = last ? rankAfter(last.rank) : firstRank();

      const group = await tx.group.create({ data: { organizationId, boardId, name, rank } });

      await tx.activityLog.create({
        data: {
          organizationId,
          boardId,
          actorType: "USER",
          actorId,
          type: "group.created",
          payload: { groupId: group.id, name },
        },
      });

      await tx.outboxEvent.create({
        data: {
          organizationId,
          boardId,
          type: "group.created",
          payload: { groupId: group.id, name },
          actorType: "USER",
          actorId,
          depth: 0,
          causedByAutomationIds: [],
        },
      });

      return group;
    }),
  );
}
