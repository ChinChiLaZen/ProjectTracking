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

export async function renameGroup(params: {
  organizationId: string;
  boardId: string;
  groupId: string;
  name: string;
  actorId: string;
}) {
  const { organizationId, boardId, groupId, name, actorId } = params;

  return runWithTenant(organizationId, () =>
    prisma.$transaction(async (tx) => {
      const group = await tx.group.findFirst({ where: { id: groupId, boardId, organizationId } });
      if (!group) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const updated = await tx.group.update({ where: { id: groupId, organizationId }, data: { name } });

      await tx.activityLog.create({
        data: {
          organizationId,
          boardId,
          actorType: "USER",
          actorId,
          type: "group.renamed",
          payload: { groupId, from: group.name, to: name },
        },
      });
      await tx.outboxEvent.create({
        data: {
          organizationId,
          boardId,
          type: "group.renamed",
          payload: { groupId, from: group.name, to: name },
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

// More destructive than create/rename (cascades to items), so gated at
// ADMIN by the router rather than GUEST like group.create/rename —
// deliberately asymmetric, see the Session 6 plan notes.
export async function deleteGroup(params: { organizationId: string; boardId: string; groupId: string; actorId: string }) {
  const { organizationId, boardId, groupId, actorId } = params;

  return runWithTenant(organizationId, () =>
    prisma.$transaction(async (tx) => {
      const group = await tx.group.findFirst({ where: { id: groupId, boardId, organizationId } });
      if (!group) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const now = new Date();
      const updated = await tx.group.update({ where: { id: groupId, organizationId }, data: { deletedAt: now } });

      // §4.2: "Deleting a Group soft-deletes its Items."
      const { count } = await tx.item.updateMany({
        where: { groupId, organizationId, deletedAt: null },
        data: { deletedAt: now },
      });

      await tx.activityLog.create({
        data: {
          organizationId,
          boardId,
          actorType: "USER",
          actorId,
          type: "group.deleted",
          payload: { groupId, itemsDeleted: count },
        },
      });
      await tx.outboxEvent.create({
        data: {
          organizationId,
          boardId,
          type: "group.deleted",
          payload: { groupId, itemsDeleted: count },
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
