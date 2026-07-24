import { createId } from "@paralleldrive/cuid2";
import { TRPCError } from "@trpc/server";
import { prisma } from "../db/client";
import { runWithTenant } from "../db/tenantContext";
import { getStorageAdapter } from "../../lib/storage";

export type AttachmentEntry = {
  id: string;
  itemId: string;
  uploaderId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: Date;
};

function trimAttachment(a: {
  id: string;
  itemId: string;
  uploaderId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: Date;
}): AttachmentEntry {
  return {
    id: a.id,
    itemId: a.itemId,
    uploaderId: a.uploaderId,
    fileName: a.fileName,
    mimeType: a.mimeType,
    fileSize: a.fileSize,
    createdAt: a.createdAt,
  };
}

// A file attached to an Item — real board *data* activity like Update, so
// this writes ActivityLog + OutboxEvent the same way (§11). The storage
// upload itself happens *before* the transaction (it's external I/O, not a
// DB write, and a failed upload must never leave a dangling DB row
// pointing at nothing) — same "read/act before opening the tx" shape
// createUpdate already uses for its mention-validation lookup.
export async function createAttachment(params: {
  organizationId: string;
  boardId: string;
  itemId: string;
  uploaderId: string;
  fileName: string;
  mimeType: string;
  body: Buffer;
}) {
  const { organizationId, boardId, itemId, uploaderId, fileName, mimeType, body } = params;

  const storageKey = `${organizationId}/${boardId}/${itemId}/${createId()}-${fileName}`;
  await getStorageAdapter().upload({ key: storageKey, body, contentType: mimeType });

  return runWithTenant(organizationId, () =>
    prisma.$transaction(async (tx) => {
      const item = await tx.item.findFirst({ where: { id: itemId, boardId, organizationId } });
      if (!item) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const attachment = await tx.attachment.create({
        data: { organizationId, boardId, itemId, uploaderId, fileName, mimeType, fileSize: body.byteLength, storageKey },
      });

      await tx.activityLog.create({
        data: {
          organizationId,
          boardId,
          itemId,
          actorType: "USER",
          actorId: uploaderId,
          type: "item.attachment_created",
          payload: { attachmentId: attachment.id, fileName },
        },
      });

      await tx.outboxEvent.create({
        data: {
          organizationId,
          boardId,
          itemId,
          type: "item.attachment_created",
          payload: { attachmentId: attachment.id, fileName },
          actorType: "USER",
          actorId: uploaderId,
          depth: 0,
          causedByAutomationIds: [],
        },
      });

      return trimAttachment(attachment);
    }),
  );
}

// Newest-first — matches how a file list is normally read (most recent
// upload first), the same order as listActivity, the reverse of
// listUpdates' chronological-thread order.
export async function listAttachments(params: {
  organizationId: string;
  boardId: string;
  itemId: string;
  cursor?: string;
  limit?: number;
}) {
  const { organizationId, boardId, itemId, cursor } = params;
  const limit = params.limit ?? 20;

  return runWithTenant(organizationId, async () => {
    const rows = await prisma.attachment.findMany({
      where: { boardId, itemId, organizationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return { entries: page.map(trimAttachment), nextCursor: hasMore ? page[page.length - 1]!.id : null };
  });
}

// Uploader can always delete their own attachment; ADMIN can delete
// anyone's (moderation) — identical shape to deleteUpdate.
export async function deleteAttachment(params: {
  organizationId: string;
  boardId: string;
  attachmentId: string;
  callerId: string;
  callerIsAdmin: boolean;
}) {
  const { organizationId, boardId, attachmentId, callerId, callerIsAdmin } = params;

  return runWithTenant(organizationId, () =>
    prisma.$transaction(async (tx) => {
      const attachment = await tx.attachment.findFirst({ where: { id: attachmentId, boardId, organizationId } });
      if (!attachment) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (attachment.uploaderId !== callerId && !callerIsAdmin) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const deleted = await tx.attachment.update({
        where: { id: attachmentId, organizationId },
        data: { deletedAt: new Date() },
      });

      await tx.activityLog.create({
        data: {
          organizationId,
          boardId,
          itemId: attachment.itemId,
          actorType: "USER",
          actorId: callerId,
          type: "item.attachment_deleted",
          payload: { attachmentId },
        },
      });

      await tx.outboxEvent.create({
        data: {
          organizationId,
          boardId,
          itemId: attachment.itemId,
          type: "item.attachment_deleted",
          payload: { attachmentId },
          actorType: "USER",
          actorId: callerId,
          depth: 0,
          causedByAutomationIds: [],
        },
      });

      return trimAttachment(deleted);
    }),
  );
}

// Used by the download Route Handler (app/api/attachments/[attachmentId])
// — a plain tenant-scoped lookup, not wrapped in the create/delete
// transactional shape since it's a read with no side effects.
export async function getAttachment(params: { organizationId: string; attachmentId: string }) {
  const { organizationId, attachmentId } = params;
  return runWithTenant(organizationId, () => prisma.attachment.findFirst({ where: { id: attachmentId, organizationId } }));
}
