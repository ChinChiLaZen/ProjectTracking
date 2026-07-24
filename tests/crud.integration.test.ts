import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../server/db/client";
import { runWithTenant } from "../server/db/tenantContext";
import { requireBoardAccess } from "../lib/permissions/requireBoardAccess";
import { getOrgRole, requireOrgRole } from "../lib/permissions/requireOrgRole";
import { createBoard, deleteBoard, renameBoard } from "../server/services/boards";
import { createGroup, deleteGroup, renameGroup } from "../server/services/groups";
import { createItem, deleteItem, listItemsInGroup, renameItem } from "../server/services/items";
import { createColumnDefinition, deleteColumnDefinition, renameColumnDefinition } from "../server/services/columnDefinitions";
import { defaultViewConfig } from "../lib/views/viewConfig";

describe("Session 6: CRUD + role enforcement", () => {
  let org: { id: string };
  let owner: { id: string };
  let member: { id: string };
  let guest: { id: string };
  let workspace: { id: string };
  let board: { id: string };

  beforeAll(async () => {
    org = await prisma.organization.create({ data: { name: "CRUD Org" } });
    owner = await prisma.user.create({ data: { email: "crud-owner@test.dev" } });
    member = await prisma.user.create({ data: { email: "crud-member@test.dev" } });
    guest = await prisma.user.create({ data: { email: "crud-guest@test.dev" } });

    await prisma.membership.createMany({
      data: [
        { organizationId: org.id, userId: owner.id, role: "OWNER" },
        { organizationId: org.id, userId: member.id, role: "MEMBER" },
        { organizationId: org.id, userId: guest.id, role: "GUEST" },
      ],
    });

    workspace = await runWithTenant(org.id, () => prisma.workspace.create({ data: { organizationId: org.id, name: "WS" } }));

    const { board: createdBoard } = await createBoard({
      organizationId: org.id,
      workspaceId: workspace.id,
      name: "Fixture Board",
      actorId: owner.id,
    });
    board = createdBoard;
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
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, member.id, guest.id] } } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
  });

  describe("requireOrgRole / getOrgRole", () => {
    it("resolves the caller's org role", async () => {
      expect(await getOrgRole({ userId: owner.id, organizationId: org.id })).toBe("OWNER");
      expect(await getOrgRole({ userId: member.id, organizationId: org.id })).toBe("MEMBER");
    });

    it("returns undefined for a non-member", async () => {
      const stranger = await prisma.user.create({ data: { email: "crud-stranger@test.dev" } });
      expect(await getOrgRole({ userId: stranger.id, organizationId: org.id })).toBeUndefined();
      await prisma.user.delete({ where: { id: stranger.id } });
    });

    it("requireOrgRole succeeds when the role meets the minimum", async () => {
      await expect(requireOrgRole({ userId: owner.id, organizationId: org.id }, "ADMIN")).resolves.toBe("OWNER");
    });

    it("requireOrgRole rejects MEMBER for an ADMIN-level action (board.create)", async () => {
      await expect(
        requireOrgRole({ userId: member.id, organizationId: org.id }, "ADMIN"),
      ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN");
    });

    it("requireOrgRole rejects GUEST outright", async () => {
      await expect(
        requireOrgRole({ userId: guest.id, organizationId: org.id }, "ADMIN"),
      ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN");
    });
  });

  describe("board CRUD", () => {
    it("createBoard also creates one starter group", async () => {
      const { board: b, group } = await createBoard({
        organizationId: org.id,
        workspaceId: workspace.id,
        name: "Another Board",
        actorId: owner.id,
      });
      expect(b.name).toBe("Another Board");
      expect(group.name).toBe("Tasks");
      expect(group.boardId).toBe(b.id);

      const activity = await prisma.activityLog.findFirst({ where: { boardId: b.id, type: "board.created" } });
      expect(activity).not.toBeNull();
    });

    it("createBoard rejects a workspaceId from another org", async () => {
      const otherOrg = await prisma.organization.create({ data: { name: "Other Org" } });
      await expect(
        createBoard({ organizationId: org.id, workspaceId: otherOrg.id, name: "X", actorId: owner.id }),
      ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND");
      await prisma.organization.delete({ where: { id: otherOrg.id } });
    });

    it("renameBoard updates the name", async () => {
      const updated = await renameBoard({ organizationId: org.id, boardId: board.id, name: "Renamed Board", actorId: owner.id });
      expect(updated.name).toBe("Renamed Board");
    });

    it("deleteBoard soft-deletes, and the board becomes unreachable via requireBoardAccess", async () => {
      const { board: toDelete } = await createBoard({
        organizationId: org.id,
        workspaceId: workspace.id,
        name: "Doomed Board",
        actorId: owner.id,
      });

      await deleteBoard({ organizationId: org.id, boardId: toDelete.id, actorId: owner.id });

      await expect(
        requireBoardAccess({ userId: owner.id, organizationId: org.id }, toDelete.id, "GUEST"),
      ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND");
    });
  });

  describe("group CRUD", () => {
    it("renameGroup updates the name", async () => {
      const group = await createGroup({ organizationId: org.id, boardId: board.id, name: "Original", actorId: owner.id });
      const updated = await renameGroup({ organizationId: org.id, boardId: board.id, groupId: group.id, name: "Renamed", actorId: owner.id });
      expect(updated.name).toBe("Renamed");
    });

    it("deleteGroup soft-deletes the group and cascades to its items only", async () => {
      const groupA = await createGroup({ organizationId: org.id, boardId: board.id, name: "Group A", actorId: owner.id });
      const groupB = await createGroup({ organizationId: org.id, boardId: board.id, name: "Group B", actorId: owner.id });

      const itemInA = await createItem({ organizationId: org.id, boardId: board.id, groupId: groupA.id, name: "In A", actorId: owner.id });
      const itemInB = await createItem({ organizationId: org.id, boardId: board.id, groupId: groupB.id, name: "In B", actorId: owner.id });

      await deleteGroup({ organizationId: org.id, boardId: board.id, groupId: groupA.id, actorId: owner.id });

      const deletedGroup = await runWithTenant(org.id, () => prisma.group.findFirst({ where: { id: groupA.id, organizationId: org.id, deletedAt: { not: null } } }));
      expect(deletedGroup).not.toBeNull();

      const deletedItem = await runWithTenant(org.id, () => prisma.item.findFirst({ where: { id: itemInA.id, organizationId: org.id, deletedAt: { not: null } } }));
      expect(deletedItem).not.toBeNull();

      // Group B and its item are untouched.
      const untouchedGroup = await runWithTenant(org.id, () => prisma.group.findFirst({ where: { id: groupB.id, organizationId: org.id } }));
      expect(untouchedGroup?.deletedAt).toBeNull();
      const untouchedItem = await runWithTenant(org.id, () => prisma.item.findFirst({ where: { id: itemInB.id, organizationId: org.id } }));
      expect(untouchedItem?.deletedAt).toBeNull();
    });
  });

  describe("item CRUD", () => {
    it("renameItem bumps version", async () => {
      const group = await createGroup({ organizationId: org.id, boardId: board.id, name: "Item Group", actorId: owner.id });
      const item = await createItem({ organizationId: org.id, boardId: board.id, groupId: group.id, name: "Old Name", actorId: owner.id });

      const updated = await renameItem({
        organizationId: org.id,
        boardId: board.id,
        itemId: item.id,
        name: "New Name",
        expectedVersion: item.version,
        actorId: owner.id,
      });
      expect(updated.name).toBe("New Name");
      expect(updated.version).toBe(item.version + 1);
    });

    it("renameItem rejects a stale expectedVersion with CONFLICT", async () => {
      const group = await createGroup({ organizationId: org.id, boardId: board.id, name: "Conflict Group", actorId: owner.id });
      const item = await createItem({ organizationId: org.id, boardId: board.id, groupId: group.id, name: "Item", actorId: owner.id });

      await renameItem({ organizationId: org.id, boardId: board.id, itemId: item.id, name: "First rename", expectedVersion: item.version, actorId: owner.id });

      await expect(
        renameItem({ organizationId: org.id, boardId: board.id, itemId: item.id, name: "Second rename", expectedVersion: item.version, actorId: owner.id }),
      ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "CONFLICT");
    });

    it("deleteItem soft-deletes and it drops out of listItemsInGroup", async () => {
      const group = await createGroup({ organizationId: org.id, boardId: board.id, name: "Delete Group", actorId: owner.id });
      const item = await createItem({ organizationId: org.id, boardId: board.id, groupId: group.id, name: "To delete", actorId: owner.id });

      await deleteItem({ organizationId: org.id, boardId: board.id, itemId: item.id, actorId: owner.id });

      const page = await listItemsInGroup({ organizationId: org.id, boardId: board.id, groupId: group.id, viewConfig: defaultViewConfig, limit: 50 });
      expect(page.items.find((i) => i.id === item.id)).toBeUndefined();
    });
  });

  describe("column CRUD", () => {
    it("renameColumnDefinition updates the name", async () => {
      const column = await createColumnDefinition({ organizationId: org.id, boardId: board.id, key: "text", name: "Old" });
      const updated = await renameColumnDefinition({ organizationId: org.id, boardId: board.id, columnId: column.id, name: "New", actorId: owner.id });
      expect(updated.name).toBe("New");
    });

    it("deleteColumnDefinition soft-deletes it out of the board's column list", async () => {
      const column = await createColumnDefinition({ organizationId: org.id, boardId: board.id, key: "text", name: "Temp Column" });
      await deleteColumnDefinition({ organizationId: org.id, boardId: board.id, columnId: column.id, actorId: owner.id });

      const remaining = await runWithTenant(org.id, () =>
        prisma.columnDefinition.findMany({ where: { boardId: board.id, organizationId: org.id } }),
      );
      expect(remaining.find((c) => c.id === column.id)).toBeUndefined();
    });
  });
});
