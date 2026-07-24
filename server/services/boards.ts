import { TRPCError } from "@trpc/server";
import { prisma } from "../db/client";
import { runWithTenant } from "../db/tenantContext";
import { firstRank } from "../../lib/ordering/rank";

export type BoardColumnDefinition = {
  id: string;
  key: string;
  name: string;
  settings: unknown; // erased on purpose — see items.ts's BoardColumnValue for why
  rank: string;
};

// Session 4: split off from the old getBoardData, which loaded every item +
// value unconditionally — the opposite of the §8 budget at 10k items. This
// is now just the board "shell": metadata, groups, and column definitions.
// Items/values are paginated per group via item.list (server/services/items.ts).
export async function getBoardShell(organizationId: string, boardId: string) {
  return runWithTenant(organizationId, async () => {
    const [board, groups, rawColumns] = await Promise.all([
      prisma.board.findFirstOrThrow({ where: { id: boardId, organizationId } }),
      prisma.group.findMany({ where: { boardId, organizationId }, orderBy: { rank: "asc" } }),
      prisma.columnDefinition.findMany({ where: { boardId, organizationId }, orderBy: { rank: "asc" } }),
    ]);

    const columns: BoardColumnDefinition[] = rawColumns.map((c) => ({
      id: c.id,
      key: c.key,
      name: c.name,
      settings: c.settings,
      rank: c.rank,
    }));

    return {
      board: { id: board.id, name: board.name, timeZone: board.timeZone },
      groups,
      columns,
    };
  });
}

// §5: "Create/delete boards... Owner/Admin" — gated at the router via
// requireOrgRole (no board exists yet to check board-level role against).
export async function createBoard(params: {
  organizationId: string;
  workspaceId: string;
  name: string;
  actorId: string;
}) {
  const { organizationId, workspaceId, name, actorId } = params;

  return runWithTenant(organizationId, () =>
    prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.findFirst({ where: { id: workspaceId, organizationId } });
      if (!workspace) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const board = await tx.board.create({ data: { organizationId, workspaceId, name } });

      // A brand-new board has nowhere to put an item until it has a group,
      // and there's no separate "create group" UI yet — auto-creating one
      // starter group is what makes a fresh board immediately usable.
      const group = await tx.group.create({
        data: { organizationId, boardId: board.id, name: "Tasks", rank: firstRank() },
      });

      // Same reasoning, one level down: without at least one column there's
      // nothing to inline-edit either. Mirrors the seed script's own
      // starter-column convention ("Task name").
      const column = await tx.columnDefinition.create({
        data: { organizationId, boardId: board.id, key: "text", name: "Task name", settings: {}, rank: firstRank() },
      });

      await tx.activityLog.create({
        data: { organizationId, boardId: board.id, actorType: "USER", actorId, type: "board.created", payload: { name } },
      });
      await tx.outboxEvent.create({
        data: {
          organizationId,
          boardId: board.id,
          type: "board.created",
          payload: { name },
          actorType: "USER",
          actorId,
          depth: 0,
          causedByAutomationIds: [],
        },
      });

      return { board, group, column };
    }),
  );
}

export async function renameBoard(params: { organizationId: string; boardId: string; name: string; actorId: string }) {
  const { organizationId, boardId, name, actorId } = params;

  return runWithTenant(organizationId, () =>
    prisma.$transaction(async (tx) => {
      const board = await tx.board.findFirst({ where: { id: boardId, organizationId } });
      if (!board) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const updated = await tx.board.update({ where: { id: boardId, organizationId }, data: { name } });

      await tx.activityLog.create({
        data: {
          organizationId,
          boardId,
          actorType: "USER",
          actorId,
          type: "board.renamed",
          payload: { from: board.name, to: name },
        },
      });
      await tx.outboxEvent.create({
        data: {
          organizationId,
          boardId,
          type: "board.renamed",
          payload: { from: board.name, to: name },
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

// Soft delete only (Ground rule #5) — child Group/Item/etc. rows are left
// as-is; they become unreachable because requireBoardAccess's own
// board.findFirst already respects deletedAt, so every procedure that
// touches this board's children fails NOT_FOUND before reaching them.
export async function deleteBoard(params: { organizationId: string; boardId: string; actorId: string }) {
  const { organizationId, boardId, actorId } = params;

  return runWithTenant(organizationId, () =>
    prisma.$transaction(async (tx) => {
      const board = await tx.board.findFirst({ where: { id: boardId, organizationId } });
      if (!board) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const updated = await tx.board.update({ where: { id: boardId, organizationId }, data: { deletedAt: new Date() } });

      await tx.activityLog.create({
        data: { organizationId, boardId, actorType: "USER", actorId, type: "board.deleted", payload: {} },
      });
      await tx.outboxEvent.create({
        data: {
          organizationId,
          boardId,
          type: "board.deleted",
          payload: {},
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
