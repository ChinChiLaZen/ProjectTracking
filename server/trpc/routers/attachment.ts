import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { requireBoardAccess } from "../../../lib/permissions/requireBoardAccess";
import { meetsMinRole } from "../../../lib/permissions/matrix";
import { deleteAttachment, listAttachments } from "../../services/attachments";

// No `create` procedure — uploading needs a multipart body, which tRPC's
// JSON-RPC transport can't carry. POST /api/attachments/upload (a Route
// Handler) does that, calling createAttachment directly. list/delete have
// no file bytes involved, so they're ordinary tRPC procedures, mirroring
// update.ts's list/delete shape exactly.
export const attachmentRouter = router({
  list: protectedProcedure
    .input(z.object({ boardId: z.string(), itemId: z.string(), cursor: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }))
    .query(async ({ ctx, input }) => {
      await requireBoardAccess(ctx, input.boardId, "GUEST"); // board.read (§5)
      return listAttachments({
        organizationId: ctx.organizationId,
        boardId: input.boardId,
        itemId: input.itemId,
        cursor: input.cursor,
        limit: input.limit,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ boardId: z.string(), attachmentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { role } = await requireBoardAccess(ctx, input.boardId, "GUEST");
      return deleteAttachment({
        organizationId: ctx.organizationId,
        boardId: input.boardId,
        attachmentId: input.attachmentId,
        callerId: ctx.userId,
        callerIsAdmin: meetsMinRole(role, "ADMIN"),
      });
    }),
});
