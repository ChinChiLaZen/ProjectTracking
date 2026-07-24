import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../server/db/client";
import { runWithTenant } from "../server/db/tenantContext";
import { createGroup } from "../server/services/groups";
import { createColumnDefinition } from "../server/services/columnDefinitions";
import { createItem } from "../server/services/items";
import { setColumnValue } from "../server/services/columnValues";
import { searchWorkspace } from "../server/services/search";

describe("searchWorkspace (Session 12 gate: §6.1 global search)", () => {
  let org: { id: string };
  let owner: { id: string };
  let guest: { id: string };
  let workspace: { id: string };
  let boardA: { id: string; name: string };
  let boardB: { id: string; name: string };
  let textColumnA: { id: string };
  let notesColumnB: { id: string };

  let nameMatchItem: { id: string };
  let valueMatchItem: { id: string };
  let bothMatchItem: { id: string };
  let guestBoardItem: { id: string };

  beforeAll(async () => {
    org = await prisma.organization.create({ data: { name: "Search Org" } });
    owner = await prisma.user.create({ data: { email: "search-owner@test.dev" } });
    guest = await prisma.user.create({ data: { email: "search-guest@test.dev" } });

    await prisma.membership.createMany({
      data: [
        { organizationId: org.id, userId: owner.id, role: "OWNER" },
        { organizationId: org.id, userId: guest.id, role: "GUEST" },
      ],
    });

    workspace = await runWithTenant(org.id, () => prisma.workspace.create({ data: { organizationId: org.id, name: "WS" } }));

    boardA = await runWithTenant(org.id, () =>
      prisma.board.create({ data: { organizationId: org.id, workspaceId: workspace.id, name: "Board A" } }),
    );
    boardB = await runWithTenant(org.id, () =>
      prisma.board.create({ data: { organizationId: org.id, workspaceId: workspace.id, name: "Board B" } }),
    );

    // Guest is only a member of Board A — Board B's matches must never
    // surface for them (§6.1's anti-leak requirement).
    await runWithTenant(org.id, () =>
      prisma.boardMembership.create({ data: { boardId: boardA.id, userId: guest.id, role: "GUEST" } }),
    );

    const groupA = await createGroup({ organizationId: org.id, boardId: boardA.id, name: "Group A", actorId: owner.id });
    const groupB = await createGroup({ organizationId: org.id, boardId: boardB.id, name: "Group B", actorId: owner.id });
    textColumnA = await createColumnDefinition({ organizationId: org.id, boardId: boardA.id, key: "text", name: "Title" });
    notesColumnB = await createColumnDefinition({ organizationId: org.id, boardId: boardB.id, key: "long_text", name: "Notes" });

    nameMatchItem = await createItem({ organizationId: org.id, boardId: boardA.id, groupId: groupA.id, name: "Quarterly rocket launch", actorId: owner.id });

    valueMatchItem = await createItem({ organizationId: org.id, boardId: boardB.id, groupId: groupB.id, name: "Unrelated item", actorId: owner.id });
    await setColumnValue({ organizationId: org.id, boardId: boardB.id, itemId: valueMatchItem.id, columnId: notesColumnB.id, value: "prepare the rocket fuel manifest", expectedVersion: 0, actorId: owner.id });

    bothMatchItem = await createItem({ organizationId: org.id, boardId: boardA.id, groupId: groupA.id, name: "rocket telemetry review", actorId: owner.id });
    await setColumnValue({ organizationId: org.id, boardId: boardA.id, itemId: bothMatchItem.id, columnId: textColumnA.id, value: "rocket checklist", expectedVersion: 0, actorId: owner.id });

    guestBoardItem = await createItem({ organizationId: org.id, boardId: boardB.id, groupId: groupB.id, name: "rocket parts inventory", actorId: owner.id });
  });

  afterAll(async () => {
    await prisma.outboxEvent.deleteMany({ where: { organizationId: org.id } });
    await prisma.activityLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.columnValue.deleteMany({ where: { organizationId: org.id } });
    await prisma.item.deleteMany({ where: { organizationId: org.id } });
    await prisma.columnDefinition.deleteMany({ where: { organizationId: org.id } });
    await prisma.group.deleteMany({ where: { organizationId: org.id } });
    await prisma.boardMembership.deleteMany({ where: { boardId: { in: [boardA.id, boardB.id] } } });
    await prisma.board.deleteMany({ where: { organizationId: org.id } });
    await prisma.workspace.deleteMany({ where: { organizationId: org.id } });
    await prisma.membership.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, guest.id] } } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
  });

  it("matches by item name", async () => {
    const results = await searchWorkspace({ organizationId: org.id, workspaceId: workspace.id, callerId: owner.id, query: "quarterly" });
    expect(results.map((r) => r.itemId)).toContain(nameMatchItem.id);
  });

  it("matches by a column's valueText", async () => {
    const results = await searchWorkspace({ organizationId: org.id, workspaceId: workspace.id, callerId: owner.id, query: "manifest" });
    expect(results.map((r) => r.itemId)).toContain(valueMatchItem.id);
  });

  it("an item matching both name and a column value appears exactly once", async () => {
    const results = await searchWorkspace({ organizationId: org.id, workspaceId: workspace.id, callerId: owner.id, query: "rocket" });
    const matches = results.filter((r) => r.itemId === bothMatchItem.id);
    expect(matches).toHaveLength(1);
  });

  it("an owner (org-wide default role) sees results from every board in the workspace", async () => {
    const results = await searchWorkspace({ organizationId: org.id, workspaceId: workspace.id, callerId: owner.id, query: "rocket" });
    const boardIds = new Set(results.map((r) => r.boardId));
    expect(boardIds.has(boardA.id)).toBe(true);
    expect(boardIds.has(boardB.id)).toBe(true);
  });

  it("a GUEST only sees results from boards they're an explicit member of", async () => {
    const results = await searchWorkspace({ organizationId: org.id, workspaceId: workspace.id, callerId: guest.id, query: "rocket" });
    const boardIds = new Set(results.map((r) => r.boardId));
    expect(boardIds.has(boardA.id)).toBe(true); // guest is a member here
    expect(boardIds.has(boardB.id)).toBe(false); // guest is NOT a member here — must not leak
    expect(results.map((r) => r.itemId)).not.toContain(guestBoardItem.id);
    expect(results.map((r) => r.itemId)).not.toContain(valueMatchItem.id);
  });

  it("cross-org search returns an empty result, not an error or a leak", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other Search Org" } });
    const results = await searchWorkspace({ organizationId: otherOrg.id, workspaceId: workspace.id, callerId: owner.id, query: "rocket" });
    expect(results).toEqual([]);
    await prisma.organization.deleteMany({ where: { id: otherOrg.id } });
  });

  it("a query with no matches returns an empty list cleanly", async () => {
    const results = await searchWorkspace({ organizationId: org.id, workspaceId: workspace.id, callerId: owner.id, query: "nonexistentxyzabc" });
    expect(results).toEqual([]);
  });

  it("an empty/blank query returns an empty list without querying the database", async () => {
    expect(await searchWorkspace({ organizationId: org.id, workspaceId: workspace.id, callerId: owner.id, query: "" })).toEqual([]);
    expect(await searchWorkspace({ organizationId: org.id, workspaceId: workspace.id, callerId: owner.id, query: "   " })).toEqual([]);
  });
});
