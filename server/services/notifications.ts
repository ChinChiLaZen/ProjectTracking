import { TRPCError } from "@trpc/server";
import { prisma } from "../db/client";
import { runWithTenant } from "../db/tenantContext";

export type NotificationEntry = {
  id: string;
  boardId: string;
  workspaceId: string;
  boardName: string;
  itemId: string;
  itemName: string;
  updateId: string;
  updateBody: string;
  type: string;
  readAt: Date | null;
  createdAt: Date;
};

const notificationInclude = {
  board: { select: { name: true, workspaceId: true } },
  item: { select: { name: true } },
  update: { select: { body: true } },
} as const;

type NotificationRow = {
  id: string;
  boardId: string;
  itemId: string;
  updateId: string;
  type: string;
  readAt: Date | null;
  createdAt: Date;
  board: { name: string; workspaceId: string };
  item: { name: string };
  update: { body: string };
};

function trimNotification(n: NotificationRow): NotificationEntry {
  return {
    id: n.id,
    boardId: n.boardId,
    workspaceId: n.board.workspaceId,
    boardName: n.board.name,
    itemId: n.itemId,
    itemName: n.item.name,
    updateId: n.updateId,
    updateBody: n.update.body,
    type: n.type,
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
}

// Session 15: notification.* procedures are session-scoped, not board-scoped
// — a genuine first for this codebase. Every prior router gates through
// requireBoardAccess; a notification is personal data (recipientId ===
// ctx.userId), closer to workspace.list's org-level scoping than any
// board-level procedure. Newest-first, the same order as listActivity.
// board/item/update names are joined in so the bell dropdown has something
// to show beyond an opaque id — a bare notification row (like ActivityLog's
// raw JSON payload) isn't useful UI content on its own here.
export async function listNotifications(params: { organizationId: string; recipientId: string; cursor?: string; limit?: number }) {
  const { organizationId, recipientId, cursor } = params;
  const limit = params.limit ?? 20;

  return runWithTenant(organizationId, async () => {
    const rows = await prisma.notification.findMany({
      where: { organizationId, recipientId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: notificationInclude,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return { entries: page.map(trimNotification), nextCursor: hasMore ? page[page.length - 1]!.id : null };
  });
}

export async function unreadCount(params: { organizationId: string; recipientId: string }): Promise<number> {
  const { organizationId, recipientId } = params;
  return runWithTenant(organizationId, () => prisma.notification.count({ where: { organizationId, recipientId, readAt: null } }));
}

export async function markRead(params: { organizationId: string; notificationId: string; callerId: string }) {
  const { organizationId, notificationId, callerId } = params;

  return runWithTenant(organizationId, async () => {
    const notification = await prisma.notification.findFirst({ where: { id: notificationId, organizationId }, include: notificationInclude });
    if (!notification) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    // Ownership check, not a board-role check — a notification belongs to
    // exactly one recipient, no ADMIN moderation override makes sense here
    // (matches the "personal, not board data" framing above).
    if (notification.recipientId !== callerId) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    const updated = await prisma.notification.update({
      where: { id: notificationId, organizationId },
      data: { readAt: notification.readAt ?? new Date() },
      include: notificationInclude,
    });
    return trimNotification(updated);
  });
}

export async function markAllRead(params: { organizationId: string; recipientId: string }): Promise<{ count: number }> {
  const { organizationId, recipientId } = params;
  return runWithTenant(organizationId, async () => {
    const result = await prisma.notification.updateMany({
      where: { organizationId, recipientId, readAt: null },
      data: { readAt: new Date() },
    });
    return { count: result.count };
  });
}
