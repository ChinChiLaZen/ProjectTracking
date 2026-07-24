import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../server/db/client";
import { runWithTenant } from "../server/db/tenantContext";
import { createGroup } from "../server/services/groups";
import { createItem, moveKanbanItem } from "../server/services/items";
import { createColumnDefinition } from "../server/services/columnDefinitions";
import { rankAfter, firstRank } from "../lib/ordering/rank";

describe("Kanban drag (Session 9): moveKanbanItem", () => {
  let org: { id: string };
  let user: { id: string };
  let board: { id: string };
  let group: { id: string };
  let statusColumn: { id: string };

  beforeAll(async () => {
    org = await prisma.organization.create({ data: { name: "Kanban Org" } });
    user = await prisma.user.create({ data: { email: "kanban-user@test.dev" } });
    await prisma.membership.create({ data: { organizationId: org.id, userId: user.id, role: "OWNER" } });

    board = await runWithTenant(org.id, async () => {
      const workspace = await prisma.workspace.create({ data: { organizationId: org.id, name: "WS" } });
      return prisma.board.create({ data: { organizationId: org.id, workspaceId: workspace.id, name: "Board" } });
    });

    group = await createGroup({ organizationId: org.id, boardId: board.id, name: "Group", actorId: user.id });
    statusColumn = await createColumnDefinition({
      organizationId: org.id,
      boardId: board.id,
      key: "status",
      name: "Status",
      settings: {
        options: [
          { id: "todo", label: "To Do", color: "#ccc", order: 0 },
          { id: "doing", label: "In Progress", color: "#fc0", order: 1 },
        ],
      },
    });
  });

  afterAll(async () => {
    await prisma.outboxEvent.deleteMany({ where: { organizationId: org.id } });
    await prisma.activityLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.columnValue.deleteMany({ where: { organizationId: org.id } });
    await prisma.item.deleteMany({ where: { organizationId: org.id } });
    await prisma.columnDefinition.deleteMany({ where: { organizationId: org.id } });
    await prisma.group.deleteMany({ where: { organizationId: org.id } });
    await prisma.board.deleteMany({ where: { organizationId: org.id } });
    await prisma.workspace.deleteMany({ where: { organizationId: org.id } });
    await prisma.membership.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
  });

  it("changes rank and columnValue together in one call", async () => {
    const item = await createItem({ organizationId: org.id, boardId: board.id, groupId: group.id, name: "Card", actorId: user.id });
    const newRank = rankAfter(firstRank());

    const result = await moveKanbanItem({
      organizationId: org.id,
      boardId: board.id,
      itemId: item.id,
      rank: newRank,
      expectedItemVersion: item.version,
      columnId: statusColumn.id,
      value: "doing",
      expectedColumnVersion: 0,
      actorId: user.id,
    });

    expect(result.item.rank).toBe(newRank);
    expect(result.item.version).toBe(item.version + 1);
    expect(result.columnValue.value).toBe("doing");
    expect(result.columnValue.version).toBe(1);

    const persistedItem = await runWithTenant(org.id, () => prisma.item.findFirst({ where: { id: item.id, organizationId: org.id } }));
    expect(persistedItem?.rank).toBe(newRank);
    const persistedValue = await runWithTenant(org.id, () =>
      prisma.columnValue.findFirst({ where: { itemId: item.id, columnId: statusColumn.id, organizationId: org.id } }),
    );
    expect(persistedValue?.value).toBe("doing");
  });

  it("writes both item.moved and item.column_changed ActivityLog rows", async () => {
    const item = await createItem({ organizationId: org.id, boardId: board.id, groupId: group.id, name: "Logged Card", actorId: user.id });

    await moveKanbanItem({
      organizationId: org.id,
      boardId: board.id,
      itemId: item.id,
      rank: rankAfter(firstRank()),
      expectedItemVersion: item.version,
      columnId: statusColumn.id,
      value: "doing",
      expectedColumnVersion: 0,
      actorId: user.id,
    });

    // createItem itself already wrote an "item.created" row — only assert
    // the two types moveKanbanItem is responsible for are both present.
    const logs = await prisma.activityLog.findMany({ where: { itemId: item.id, organizationId: org.id } });
    expect(logs.map((l) => l.type)).toEqual(expect.arrayContaining(["item.moved", "item.column_changed"]));

    const outbox = await prisma.outboxEvent.findMany({ where: { itemId: item.id, organizationId: org.id } });
    expect(outbox.map((e) => e.type)).toEqual(expect.arrayContaining(["item.moved", "item.column_changed"]));
  });

  // The whole point of combining these into one transaction: a version
  // conflict on EITHER half must roll back BOTH, not leave a card half-moved.
  describe("atomicity", () => {
    it("a stale expectedItemVersion rejects with CONFLICT and leaves the columnValue untouched", async () => {
      const item = await createItem({ organizationId: org.id, boardId: board.id, groupId: group.id, name: "Item-Stale Card", actorId: user.id });

      // Bump the item's version out from under the upcoming call.
      await runWithTenant(org.id, () =>
        prisma.item.update({ where: { id: item.id, organizationId: org.id }, data: { version: { increment: 1 } } }),
      );

      await expect(
        moveKanbanItem({
          organizationId: org.id,
          boardId: board.id,
          itemId: item.id,
          rank: rankAfter(firstRank()),
          expectedItemVersion: item.version, // now stale
          columnId: statusColumn.id,
          value: "doing",
          expectedColumnVersion: 0,
          actorId: user.id,
        }),
      ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "CONFLICT");

      const columnValue = await runWithTenant(org.id, () =>
        prisma.columnValue.findFirst({ where: { itemId: item.id, columnId: statusColumn.id, organizationId: org.id } }),
      );
      expect(columnValue).toBeNull(); // never written — the transaction rolled back
    });

    it("a stale expectedColumnVersion rejects with CONFLICT and leaves the item's rank untouched", async () => {
      const item = await createItem({ organizationId: org.id, boardId: board.id, groupId: group.id, name: "Column-Stale Card", actorId: user.id });
      const originalRank = item.rank;

      // A prior write establishes a real columnValue at version 1.
      await moveKanbanItem({
        organizationId: org.id,
        boardId: board.id,
        itemId: item.id,
        rank: rankAfter(firstRank()),
        expectedItemVersion: item.version,
        columnId: statusColumn.id,
        value: "todo",
        expectedColumnVersion: 0,
        actorId: user.id,
      });

      const itemAfterFirstMove = await runWithTenant(org.id, () =>
        prisma.item.findFirstOrThrow({ where: { id: item.id, organizationId: org.id } }),
      );
      const rankBeforeConflict = itemAfterFirstMove.rank;

      await expect(
        moveKanbanItem({
          organizationId: org.id,
          boardId: board.id,
          itemId: item.id,
          rank: rankAfter(itemAfterFirstMove.rank),
          expectedItemVersion: itemAfterFirstMove.version,
          columnId: statusColumn.id,
          value: "doing",
          expectedColumnVersion: 0, // stale — the columnValue is actually at version 1 now
          actorId: user.id,
        }),
      ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "CONFLICT");

      const itemAfterConflict = await runWithTenant(org.id, () =>
        prisma.item.findFirstOrThrow({ where: { id: item.id, organizationId: org.id } }),
      );
      // Rank must still equal what it was right before the rejected call —
      // not the original creation rank, and not the rank the rejected call
      // tried to write.
      expect(itemAfterConflict.rank).toBe(rankBeforeConflict);
      expect(itemAfterConflict.rank).not.toBe(originalRank);
      expect(itemAfterConflict.version).toBe(itemAfterFirstMove.version);
    });
  });

  it("rejects a cross-board itemId with NOT_FOUND", async () => {
    const otherBoard = await runWithTenant(org.id, async () => {
      const workspace = await prisma.workspace.findFirstOrThrow({ where: { organizationId: org.id } });
      return prisma.board.create({ data: { organizationId: org.id, workspaceId: workspace.id, name: "Other Board" } });
    });
    const otherGroup = await createGroup({ organizationId: org.id, boardId: otherBoard.id, name: "Other Group", actorId: user.id });
    const otherItem = await createItem({ organizationId: org.id, boardId: otherBoard.id, groupId: otherGroup.id, name: "Elsewhere", actorId: user.id });

    await expect(
      moveKanbanItem({
        organizationId: org.id,
        boardId: board.id, // wrong board for this item
        itemId: otherItem.id,
        rank: rankAfter(firstRank()),
        expectedItemVersion: otherItem.version,
        columnId: statusColumn.id,
        value: "doing",
        expectedColumnVersion: 0,
        actorId: user.id,
      }),
    ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND");

    await prisma.item.deleteMany({ where: { boardId: otherBoard.id, organizationId: org.id } });
    await prisma.group.deleteMany({ where: { boardId: otherBoard.id, organizationId: org.id } });
    await prisma.board.deleteMany({ where: { id: otherBoard.id, organizationId: org.id } });
  });
});
