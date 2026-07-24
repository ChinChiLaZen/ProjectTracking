import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../server/db/client";
import { runWithTenant } from "../server/db/tenantContext";
import { createGroup, moveGroup } from "../server/services/groups";
import { createItem, moveItem } from "../server/services/items";
import { rebalanceRanks } from "../lib/ordering/rebalance";
import { firstRank, rankAfter } from "../lib/ordering/rank";

describe("Drag-to-reorder (Session 3 gate)", () => {
  let org: { id: string };
  let user: { id: string };
  let board: { id: string };
  let groupA: { id: string };
  let groupB: { id: string };

  beforeAll(async () => {
    org = await prisma.organization.create({ data: { name: "Reorder Org" } });
    user = await prisma.user.create({ data: { email: "reorder-user@test.dev" } });
    await prisma.membership.create({ data: { organizationId: org.id, userId: user.id, role: "OWNER" } });

    board = await runWithTenant(org.id, async () => {
      const workspace = await prisma.workspace.create({ data: { organizationId: org.id, name: "WS" } });
      return prisma.board.create({ data: { organizationId: org.id, workspaceId: workspace.id, name: "Board" } });
    });

    groupA = await createGroup({ organizationId: org.id, boardId: board.id, name: "Group A", actorId: user.id });
    groupB = await createGroup({ organizationId: org.id, boardId: board.id, name: "Group B", actorId: user.id });
  });

  afterAll(async () => {
    await prisma.outboxEvent.deleteMany({ where: { organizationId: org.id } });
    await prisma.activityLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.item.deleteMany({ where: { organizationId: org.id } });
    await prisma.group.deleteMany({ where: { organizationId: org.id } });
    await prisma.board.deleteMany({ where: { organizationId: org.id } });
    await prisma.workspace.deleteMany({ where: { organizationId: org.id } });
    await prisma.membership.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
  });

  it("moveItem updates exactly the target item's row and leaves siblings untouched", async () => {
    const item1 = await createItem({ organizationId: org.id, boardId: board.id, groupId: groupA.id, name: "Item 1", actorId: user.id });
    await createItem({ organizationId: org.id, boardId: board.id, groupId: groupA.id, name: "Item 2", actorId: user.id });
    await createItem({ organizationId: org.id, boardId: board.id, groupId: groupA.id, name: "Item 3", actorId: user.id });

    const before = await runWithTenant(org.id, () =>
      prisma.item.findMany({ where: { groupId: groupA.id, organizationId: org.id }, orderBy: { number: "asc" } }),
    );

    const newRank = rankAfter(firstRank());
    const moved = await moveItem({
      organizationId: org.id,
      boardId: board.id,
      itemId: item1.id,
      groupId: groupA.id,
      rank: newRank,
      expectedVersion: item1.version,
      actorId: user.id,
    });

    expect(moved.rank).toBe(newRank);
    expect(moved.version).toBe(item1.version + 1);

    const after = await runWithTenant(org.id, () =>
      prisma.item.findMany({ where: { groupId: groupA.id, organizationId: org.id }, orderBy: { number: "asc" } }),
    );

    // The Session 3 gate: exactly one row changed.
    for (const beforeRow of before) {
      const afterRow = after.find((r) => r.id === beforeRow.id);
      expect(afterRow).toBeDefined();
      if (beforeRow.id === item1.id) {
        expect(afterRow!.rank).toBe(newRank);
        expect(afterRow!.version).toBe(beforeRow.version + 1);
      } else {
        expect(afterRow).toEqual(beforeRow);
      }
    }
  });

  it("rejects a stale expectedVersion on moveItem with CONFLICT", async () => {
    const item = await createItem({ organizationId: org.id, boardId: board.id, groupId: groupA.id, name: "Conflict Item", actorId: user.id });

    await moveItem({
      organizationId: org.id,
      boardId: board.id,
      itemId: item.id,
      groupId: groupA.id,
      rank: rankAfter(firstRank()),
      expectedVersion: item.version,
      actorId: user.id,
    });

    await expect(
      moveItem({
        organizationId: org.id,
        boardId: board.id,
        itemId: item.id,
        groupId: groupA.id,
        rank: rankAfter(firstRank()),
        expectedVersion: item.version, // stale — already bumped by the move above
        actorId: user.id,
      }),
    ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "CONFLICT");
  });

  it("rejects a malformed rank with BAD_REQUEST", async () => {
    const item = await createItem({ organizationId: org.id, boardId: board.id, groupId: groupA.id, name: "Bad Rank Item", actorId: user.id });

    await expect(
      moveItem({
        organizationId: org.id,
        boardId: board.id,
        itemId: item.id,
        groupId: groupA.id,
        rank: "1invalid", // fractional-indexing rejects a leading digit as the head character
        expectedVersion: item.version,
        actorId: user.id,
      }),
    ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "BAD_REQUEST");

    await expect(
      moveGroup({ organizationId: org.id, boardId: board.id, groupId: groupA.id, rank: "#invalid", actorId: user.id }),
    ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "BAD_REQUEST");
  });

  it("moveGroup updates exactly the target group's row", async () => {
    const before = await runWithTenant(org.id, () =>
      prisma.group.findMany({ where: { boardId: board.id, organizationId: org.id } }),
    );

    const newRank = rankAfter(firstRank());
    const moved = await moveGroup({ organizationId: org.id, boardId: board.id, groupId: groupB.id, rank: newRank, actorId: user.id });
    expect(moved.rank).toBe(newRank);

    const after = await runWithTenant(org.id, () =>
      prisma.group.findMany({ where: { boardId: board.id, organizationId: org.id } }),
    );

    for (const beforeRow of before) {
      const afterRow = after.find((r) => r.id === beforeRow.id);
      expect(afterRow).toBeDefined();
      if (beforeRow.id === groupB.id) {
        expect(afterRow!.rank).toBe(newRank);
      } else {
        expect(afterRow).toEqual(beforeRow);
      }
    }
  });

  it("rebalanceRanks re-spaces items in a group without changing logical order", async () => {
    const group = await createGroup({ organizationId: org.id, boardId: board.id, name: "Rebalance Group", actorId: user.id });
    const a = await createItem({ organizationId: org.id, boardId: board.id, groupId: group.id, name: "A", actorId: user.id });
    const b = await createItem({ organizationId: org.id, boardId: board.id, groupId: group.id, name: "B", actorId: user.id });
    const c = await createItem({ organizationId: org.id, boardId: board.id, groupId: group.id, name: "C", actorId: user.id });

    const beforeOrder = await runWithTenant(org.id, () =>
      prisma.item.findMany({ where: { groupId: group.id, organizationId: org.id }, orderBy: { rank: "asc" } }),
    );
    expect(beforeOrder.map((i) => i.id)).toEqual([a.id, b.id, c.id]);

    const result = await rebalanceRanks({ organizationId: org.id, scope: { type: "itemsInGroup", groupId: group.id } });
    expect(result.count).toBe(3);

    const afterOrder = await runWithTenant(org.id, () =>
      prisma.item.findMany({ where: { groupId: group.id, organizationId: org.id }, orderBy: { rank: "asc" } }),
    );
    expect(afterOrder.map((i) => i.id)).toEqual([a.id, b.id, c.id]);
    for (const item of afterOrder) {
      expect(item.rank.length).toBeLessThan(10);
    }
  });
});
