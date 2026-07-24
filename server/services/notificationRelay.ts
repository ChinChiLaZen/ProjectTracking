import { prisma } from "../db/client";
import { runWithTenant } from "../db/tenantContext";
import { sendEmail as defaultSendEmail } from "../../lib/mailer";

type SendEmailFn = typeof defaultSendEmail;

export type DeliverMentionEmailsResult = { processed: number; sent: number };

type UpdateCreatedPayload = { updateId?: string; body?: string; mentionedUserIds?: string[] };

// Session 15: the one piece of Phase 3's done-when that genuinely needs
// outbox/relay treatment (§7.1) rather than a same-transaction write — an
// external SMTP call shouldn't happen inside the comment-post request, and
// shouldn't be lost if the process dies mid-send. This is a plain, fully-
// tested, callable function, deliberately NOT wired to a scheduler this
// session — same precedent already set for rebalanceRanks (Session 3):
// build the capability now, Phase 4's worker (or an interim cron) is what
// eventually calls this on a schedule.
//
// Deliberately NOT wrapped in one outer runWithTenant call, unlike every
// other service function — this is a system-wide relay that must see
// unpublished events across every organization at once, the same kind of
// intentionally cross-tenant read searchWorkspace's raw SQL already is
// (§14's Session 12 decision log entry). Each event's own processing
// re-enters tenant context via runWithTenant(event.organizationId, ...)
// for the extension's defense-in-depth on every read/write it performs.
//
// Idempotent by construction: emailSentAt (on Notification) and
// publishedAt (on OutboxEvent) are both set only after a successful send,
// and both are checked before doing anything — calling this twice over the
// same rows never double-sends, satisfying "deduped" for email the same
// way @@unique([recipientId, updateId]) does for the in-app half.
export async function deliverMentionEmails(
  params: { limit?: number; sendEmail?: SendEmailFn } = {},
): Promise<DeliverMentionEmailsResult> {
  const limit = params.limit ?? 50;
  const sendEmail = params.sendEmail ?? defaultSendEmail;

  const events = await prisma.outboxEvent.findMany({
    where: { type: "item.update_created", publishedAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let sent = 0;

  for (const event of events) {
    await runWithTenant(event.organizationId, async () => {
      const payload = event.payload as UpdateCreatedPayload | null;
      const mentionedUserIds = payload?.mentionedUserIds ?? [];

      if (payload?.updateId && event.itemId && mentionedUserIds.length > 0) {
        const [item, board, author] = await Promise.all([
          prisma.item.findFirst({ where: { id: event.itemId, organizationId: event.organizationId } }),
          prisma.board.findFirst({ where: { id: event.boardId, organizationId: event.organizationId } }),
          prisma.user.findUnique({ where: { id: event.actorId } }),
        ]);
        const authorLabel = author?.name ?? author?.email ?? "Someone";

        for (const recipientId of mentionedUserIds) {
          // Missing means either already emailed (emailSentAt already set,
          // filtered out by the where clause) or a self-mention, which
          // never got a Notification row in createUpdate to begin with.
          const notification = await prisma.notification.findFirst({
            where: { organizationId: event.organizationId, recipientId, updateId: payload.updateId, emailSentAt: null },
          });
          if (!notification) continue;

          const recipient = await prisma.user.findUnique({ where: { id: recipientId } });
          if (!recipient) continue;

          await sendEmail({
            to: recipient.email,
            subject: `${authorLabel} mentioned you in "${item?.name ?? "an item"}"`,
            text: `${authorLabel} mentioned you on the "${board?.name ?? "a board"}" board:\n\n${payload.body ?? ""}`,
          });

          // updateMany rather than update: tolerates the row having
          // vanished between the read above and this write (e.g. a
          // concurrent cleanup/relay run) by matching zero rows instead of
          // throwing "record not found" — the same at-least-once
          // tolerance a real relay needs regardless of test concurrency.
          await prisma.notification.updateMany({
            where: { id: notification.id, organizationId: event.organizationId },
            data: { emailSentAt: new Date() },
          });
          sent += 1;
        }
      }

      await prisma.outboxEvent.updateMany({
        where: { id: event.id, organizationId: event.organizationId },
        data: { publishedAt: new Date() },
      });
    });
  }

  return { processed: events.length, sent };
}
