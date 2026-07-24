import { TRPCError } from "@trpc/server";
import { prisma } from "../db/client";
import { runWithTenant } from "../db/tenantContext";

export type UpdateEntry = {
  id: string;
  itemId: string;
  authorId: string;
  body: string;
  createdAt: Date;
};

function trimUpdate(u: { id: string; itemId: string; authorId: string; body: string; createdAt: Date }): UpdateEntry {
  return { id: u.id, itemId: u.itemId, authorId: u.authorId, body: u.body, createdAt: u.createdAt };
}

// A comment on an Item — real board *data* activity (unlike View, which is
// board configuration), so this writes ActivityLog + OutboxEvent the same
// way item.create/setColumnValue do, all in one transaction (§11).
export async function createUpdate(params: {
  organizationId: string;
  boardId: string;
  itemId: string;
  authorId: string;
  body: string;
}) {
  const { organizationId, boardId, itemId, authorId, body } = params;

  return runWithTenant(organizationId, () =>
    prisma.$transaction(async (tx) => {
      const item = await tx.item.findFirst({ where: { id: itemId, boardId, organizationId } });
      if (!item) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const update = await tx.update.create({
        data: { organizationId, boardId, itemId, authorId, body },
      });

      await tx.activityLog.create({
        data: {
          organizationId,
          boardId,
          itemId,
          actorType: "USER",
          actorId: authorId,
          type: "item.update_created",
          payload: { updateId: update.id, body },
        },
      });

      await tx.outboxEvent.create({
        data: {
          organizationId,
          boardId,
          itemId,
          type: "item.update_created",
          payload: { updateId: update.id, body },
          actorType: "USER",
          actorId: authorId,
          depth: 0,
          causedByAutomationIds: [],
        },
      });

      return trimUpdate(update);
    }),
  );
}

// Chronological (oldest-first) cursor pagination — the reverse of
// listActivity's newest-first feed order, matching how a comment thread
// reads top-to-bottom.
export async function listUpdates(params: {
  organizationId: string;
  boardId: string;
  itemId: string;
  cursor?: string;
  limit?: number;
}) {
  const { organizationId, boardId, itemId, cursor } = params;
  const limit = params.limit ?? 20;

  return runWithTenant(organizationId, async () => {
    const rows = await prisma.update.findMany({
      where: { boardId, itemId, organizationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return { entries: page.map(trimUpdate), nextCursor: hasMore ? page[page.length - 1]!.id : null };
  });
}

// Creator can always delete their own comment; ADMIN can delete anyone's
// (moderation) — identical shape to deleteView (server/services/views.ts).
export async function deleteUpdate(params: {
  organizationId: string;
  boardId: string;
  updateId: string;
  callerId: string;
  callerIsAdmin: boolean;
}) {
  const { organizationId, boardId, updateId, callerId, callerIsAdmin } = params;

  return runWithTenant(organizationId, () =>
    prisma.$transaction(async (tx) => {
      const update = await tx.update.findFirst({ where: { id: updateId, boardId, organizationId } });
      if (!update) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (update.authorId !== callerId && !callerIsAdmin) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const deleted = await tx.update.update({ where: { id: updateId, organizationId }, data: { deletedAt: new Date() } });

      await tx.activityLog.create({
        data: {
          organizationId,
          boardId,
          itemId: update.itemId,
          actorType: "USER",
          actorId: callerId,
          type: "item.update_deleted",
          payload: { updateId },
        },
      });

      await tx.outboxEvent.create({
        data: {
          organizationId,
          boardId,
          itemId: update.itemId,
          type: "item.update_deleted",
          payload: { updateId },
          actorType: "USER",
          actorId: callerId,
          depth: 0,
          causedByAutomationIds: [],
        },
      });

      return trimUpdate(deleted);
    }),
  );
}
