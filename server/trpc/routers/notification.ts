import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { listNotifications, markAllRead, markRead, unreadCount } from "../../services/notifications";

// Session 15: session-scoped, not board-scoped — a genuine first for this
// codebase. A notification is personal data (recipientId === ctx.userId),
// so no requireBoardAccess gate applies; every procedure just trusts the
// session's own userId/organizationId (Ground rules #4).
export const notificationRouter = router({
  list: protectedProcedure
    .input(z.object({ cursor: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }))
    .query(({ ctx, input }) =>
      listNotifications({ organizationId: ctx.organizationId, recipientId: ctx.userId, cursor: input.cursor, limit: input.limit }),
    ),

  unreadCount: protectedProcedure.query(({ ctx }) => unreadCount({ organizationId: ctx.organizationId, recipientId: ctx.userId })),

  markRead: protectedProcedure
    .input(z.object({ notificationId: z.string() }))
    .mutation(({ ctx, input }) =>
      markRead({ organizationId: ctx.organizationId, notificationId: input.notificationId, callerId: ctx.userId }),
    ),

  markAllRead: protectedProcedure.mutation(({ ctx }) => markAllRead({ organizationId: ctx.organizationId, recipientId: ctx.userId })),
});
