import { TRPCError } from "@trpc/server";
import { prisma } from "../db/client";
import { runWithTenant } from "../db/tenantContext";
import { firstRank, isValidRank, rankAfter } from "../../lib/ordering/rank";

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

// Drag-to-reorder (§10.1 Session 3 gate: exactly one row updated). No
// expectedVersion check — Group has no `version` column (§4.2 only names
// Item/ColumnValue for optimistic concurrency); reorder is last-write-wins.
export async function moveGroup(params: {
  organizationId: string;
  boardId: string;
  groupId: string;
  rank: string;
  actorId: string;
}) {
  const { organizationId, boardId, groupId, rank, actorId } = params;

  if (!isValidRank(rank)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid rank" });
  }

  return runWithTenant(organizationId, () =>
    prisma.$transaction(async (tx) => {
      const group = await tx.group.findFirst({ where: { id: groupId, boardId, organizationId } });
      if (!group) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const updated = await tx.group.update({
        where: { id: groupId, organizationId },
        data: { rank },
      });

      await tx.activityLog.create({
        data: {
          organizationId,
          boardId,
          actorType: "USER",
          actorId,
          type: "group.moved",
          payload: { groupId, rank },
        },
      });

      await tx.outboxEvent.create({
        data: {
          organizationId,
          boardId,
          type: "group.moved",
          payload: { groupId, rank },
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
