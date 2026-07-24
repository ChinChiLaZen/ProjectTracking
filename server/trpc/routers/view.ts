import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { requireBoardAccess } from "../../../lib/permissions/requireBoardAccess";
import { meetsMinRole } from "../../../lib/permissions/matrix";
import { createView, deleteView, getView, listViews, updateView } from "../../services/views";
import { viewConfigSchema } from "../../../lib/views/viewConfig";

// Trimmed to erase `config`'s Prisma Json type to `unknown` — same fix as
// BoardColumnValue (server/services/items.ts): a raw Json field flowing
// through react-query's generics blows up TS with "excessively deep type
// instantiation" (see the Session 2 decision log).
function trimView(view: {
  id: string;
  boardId: string;
  name: string;
  visibility: "SHARED" | "PERSONAL";
  creatorId: string;
  config: unknown;
  createdAt: Date;
}) {
  return {
    id: view.id,
    boardId: view.boardId,
    name: view.name,
    visibility: view.visibility,
    creatorId: view.creatorId,
    config: view.config as unknown,
    createdAt: view.createdAt,
  };
}

export const viewRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        boardId: z.string(),
        name: z.string().trim().min(1),
        visibility: z.enum(["SHARED", "PERSONAL"]),
        config: viewConfigSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // §5 / matrix.ts: a SHARED view needs board.editStructure (ADMIN); a
      // PERSONAL view needs only view.createPersonal (GUEST) — the router
      // doesn't know which capability applies until it's seen the input.
      const minRole = input.visibility === "SHARED" ? "ADMIN" : "GUEST";
      await requireBoardAccess(ctx, input.boardId, minRole);
      const view = await createView({
        organizationId: ctx.organizationId,
        boardId: input.boardId,
        name: input.name,
        visibility: input.visibility,
        config: input.config ?? {},
        creatorId: ctx.userId,
      });
      return trimView(view);
    }),

  list: protectedProcedure.input(z.object({ boardId: z.string() })).query(async ({ ctx, input }) => {
    await requireBoardAccess(ctx, input.boardId, "GUEST"); // board.read (§5)
    const views = await listViews({ organizationId: ctx.organizationId, boardId: input.boardId, callerId: ctx.userId });
    return views.map(trimView);
  }),

  get: protectedProcedure
    .input(z.object({ boardId: z.string(), viewId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireBoardAccess(ctx, input.boardId, "GUEST"); // board.read (§5)
      const view = await getView({
        organizationId: ctx.organizationId,
        boardId: input.boardId,
        viewId: input.viewId,
        callerId: ctx.userId,
      });
      return trimView(view);
    }),

  // Fine-grained permission (creator-only for PERSONAL, creator-or-ADMIN for
  // SHARED) lives in the service — it depends on the existing view's own
  // visibility/creator, which the router can't know without a lookup.
  // Mirrors delete's shape: GUEST (board.read) gate here, callerIsAdmin
  // computed and handed down.
  update: protectedProcedure
    .input(
      z.object({
        boardId: z.string(),
        viewId: z.string(),
        name: z.string().trim().min(1).optional(),
        config: viewConfigSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { role } = await requireBoardAccess(ctx, input.boardId, "GUEST");
      const view = await updateView({
        organizationId: ctx.organizationId,
        boardId: input.boardId,
        viewId: input.viewId,
        callerId: ctx.userId,
        callerIsAdmin: meetsMinRole(role, "ADMIN"),
        name: input.name,
        config: input.config,
      });
      return trimView(view);
    }),

  delete: protectedProcedure
    .input(z.object({ boardId: z.string(), viewId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { role } = await requireBoardAccess(ctx, input.boardId, "GUEST");
      const view = await deleteView({
        organizationId: ctx.organizationId,
        boardId: input.boardId,
        viewId: input.viewId,
        callerId: ctx.userId,
        callerIsAdmin: meetsMinRole(role, "ADMIN"),
      });
      return trimView(view);
    }),
});
