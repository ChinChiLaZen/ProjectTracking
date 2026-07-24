import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../server/db/client";
import { runWithTenant } from "../server/db/tenantContext";
import { createGroup } from "../server/services/groups";
import { createColumnDefinition } from "../server/services/columnDefinitions";
import { createItem } from "../server/services/items";
import { setColumnValue } from "../server/services/columnValues";

describe("Board -> Group -> Item -> ColumnValue vertical slice (Session 2 gate)", () => {
  let org: { id: string };
  let otherOrg: { id: string };
  let user: { id: string };
  let board: { id: string };
  let otherBoard: { id: string };

  beforeAll(async () => {
    org = await prisma.organization.create({ data: { name: "Slice Org" } });
    otherOrg = await prisma.organization.create({ data: { name: "Other Org" } });
    user = await prisma.user.create({ data: { email: "slice-user@test.dev" } });
    await prisma.membership.create({ data: { organizationId: org.id, userId: user.id, role: "OWNER" } });

    board = await runWithTenant(org.id, async () => {
      const workspace = await prisma.workspace.create({ data: { organizationId: org.id, name: "WS" } });
      return prisma.board.create({ data: { organizationId: org.id, workspaceId: workspace.id, name: "Board" } });
    });

    otherBoard = await runWithTenant(otherOrg.id, async () => {
      const workspace = await prisma.workspace.create({ data: { organizationId: otherOrg.id, name: "WS 2" } });
      return prisma.board.create({
        data: { organizationId: otherOrg.id, workspaceId: workspace.id, name: "Other Board" },
      });
    });
  });

  afterAll(async () => {
    const orgIds = [org.id, otherOrg.id];
    await prisma.outboxEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.activityLog.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.columnValue.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.item.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.columnDefinition.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.group.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.board.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.workspace.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.membership.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  it("creates a group, item, column, and sets a value with correct shadow projection + audit rows", async () => {
    const group = await createGroup({ organizationId: org.id, boardId: board.id, name: "Group 1", actorId: user.id });
    const column = await createColumnDefinition({
      organizationId: org.id,
      boardId: board.id,
      key: "text",
      name: "Name",
    });
    const item = await createItem({
      organizationId: org.id,
      boardId: board.id,
      groupId: group.id,
      name: "Item 1",
      actorId: user.id,
    });

    const columnValue = await setColumnValue({
      organizationId: org.id,
      boardId: board.id,
      itemId: item.id,
      columnId: column.id,
      value: "hello world",
      expectedVersion: 0,
      actorId: user.id,
    });

    expect(columnValue.value).toBe("hello world");
    expect(columnValue.valueText).toBe("hello world");
    expect(columnValue.version).toBe(1);

    const activityLogs = await prisma.activityLog.findMany({
      where: { itemId: item.id, type: "item.column_changed" },
    });
    expect(activityLogs).toHaveLength(1);

    const outboxEvents = await prisma.outboxEvent.findMany({
      where: { itemId: item.id, type: "item.column_changed" },
    });
    expect(outboxEvents).toHaveLength(1);
    expect(outboxEvents[0].publishedAt).toBeNull();
  });

  it("bumps version on a subsequent write with the correct expectedVersion", async () => {
    const group = await createGroup({ organizationId: org.id, boardId: board.id, name: "Group 2", actorId: user.id });
    const column = await createColumnDefinition({
      organizationId: org.id,
      boardId: board.id,
      key: "text",
      name: "Name 2",
    });
    const item = await createItem({
      organizationId: org.id,
      boardId: board.id,
      groupId: group.id,
      name: "Item 2",
      actorId: user.id,
    });

    const first = await setColumnValue({
      organizationId: org.id,
      boardId: board.id,
      itemId: item.id,
      columnId: column.id,
      value: "v1",
      expectedVersion: 0,
      actorId: user.id,
    });
    expect(first.version).toBe(1);

    const second = await setColumnValue({
      organizationId: org.id,
      boardId: board.id,
      itemId: item.id,
      columnId: column.id,
      value: "v2",
      expectedVersion: 1,
      actorId: user.id,
    });
    expect(second.version).toBe(2);
    expect(second.value).toBe("v2");
  });

  it("rejects a stale expectedVersion with CONFLICT", async () => {
    const group = await createGroup({ organizationId: org.id, boardId: board.id, name: "Group 3", actorId: user.id });
    const column = await createColumnDefinition({
      organizationId: org.id,
      boardId: board.id,
      key: "text",
      name: "Name 3",
    });
    const item = await createItem({
      organizationId: org.id,
      boardId: board.id,
      groupId: group.id,
      name: "Item 3",
      actorId: user.id,
    });

    await setColumnValue({
      organizationId: org.id,
      boardId: board.id,
      itemId: item.id,
      columnId: column.id,
      value: "v1",
      expectedVersion: 0,
      actorId: user.id,
    });

    await expect(
      setColumnValue({
        organizationId: org.id,
        boardId: board.id,
        itemId: item.id,
        columnId: column.id,
        value: "v2",
        expectedVersion: 0,
        actorId: user.id,
      }),
    ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "CONFLICT");
  });

  it("rejects setColumnValue for an item/column that belongs to a different org's board", async () => {
    const group = await createGroup({ organizationId: org.id, boardId: board.id, name: "Group 4", actorId: user.id });
    const column = await createColumnDefinition({
      organizationId: org.id,
      boardId: board.id,
      key: "text",
      name: "Name 4",
    });
    const item = await createItem({
      organizationId: org.id,
      boardId: board.id,
      groupId: group.id,
      name: "Item 4",
      actorId: user.id,
    });

    await expect(
      setColumnValue({
        organizationId: otherOrg.id,
        boardId: otherBoard.id,
        itemId: item.id,
        columnId: column.id,
        value: "v1",
        expectedVersion: 0,
        actorId: user.id,
      }),
    ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND");
  });
});
