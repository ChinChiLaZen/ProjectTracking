import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../server/db/client";
import { runWithTenant } from "../server/db/tenantContext";
import { createGroup } from "../server/services/groups";
import { createColumnDefinition } from "../server/services/columnDefinitions";
import { createItem, listItemsInGroup } from "../server/services/items";
import { setColumnValue } from "../server/services/columnValues";
import { defaultViewConfig, viewConfigSchema } from "../lib/views/viewConfig";

describe("listItemsInGroup (Session 4 gate: pagination + filter + sort)", () => {
  let org: { id: string };
  let otherOrg: { id: string };
  let user: { id: string };
  let board: { id: string };
  let group: { id: string };
  let column: { id: string };
  const itemIdsInOrder: string[] = [];

  beforeAll(async () => {
    org = await prisma.organization.create({ data: { name: "ItemList Org" } });
    otherOrg = await prisma.organization.create({ data: { name: "Other Org" } });
    user = await prisma.user.create({ data: { email: "itemlist-user@test.dev" } });
    await prisma.membership.create({ data: { organizationId: org.id, userId: user.id, role: "OWNER" } });

    board = await runWithTenant(org.id, async () => {
      const workspace = await prisma.workspace.create({ data: { organizationId: org.id, name: "WS" } });
      return prisma.board.create({ data: { organizationId: org.id, workspaceId: workspace.id, name: "Board" } });
    });

    group = await createGroup({ organizationId: org.id, boardId: board.id, name: "Group", actorId: user.id });
    column = await createColumnDefinition({ organizationId: org.id, boardId: board.id, key: "text", name: "Title" });

    // 10 items, values "Item 0".."Item 9" in creation (= rank) order.
    for (let i = 0; i < 10; i++) {
      const item = await createItem({ organizationId: org.id, boardId: board.id, groupId: group.id, name: `Item ${i}`, actorId: user.id });
      await setColumnValue({
        organizationId: org.id,
        boardId: board.id,
        itemId: item.id,
        columnId: column.id,
        value: `Item ${i}`,
        expectedVersion: 0,
        actorId: user.id,
      });
      itemIdsInOrder.push(item.id);
    }
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

  it("default order matches rank (creation order here) with no sort in viewConfig", async () => {
    const page = await listItemsInGroup({ organizationId: org.id, boardId: board.id, groupId: group.id, viewConfig: defaultViewConfig, limit: 50 });
    expect(page.items.map((i) => i.id)).toEqual(itemIdsInOrder);
    expect(page.nextCursor).toBeNull();
  });

  it("paginates with no gaps or duplicates across pages", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;

    for (let guard = 0; guard < 20; guard++) {
      const page = await listItemsInGroup({
        organizationId: org.id,
        boardId: board.id,
        groupId: group.id,
        viewConfig: defaultViewConfig,
        cursor,
        limit: 3,
      });
      seen.push(...page.items.map((i) => i.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    expect(seen).toEqual(itemIdsInOrder);
    expect(new Set(seen).size).toBe(itemIdsInOrder.length);
  });

  it("a filter excludes non-matching items", async () => {
    const viewConfig = viewConfigSchema.parse({
      filters: [{ columnId: column.id, operatorKey: "equals", args: ["Item 3"] }],
    });

    const page = await listItemsInGroup({ organizationId: org.id, boardId: board.id, groupId: group.id, viewConfig, limit: 50 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.id).toBe(itemIdsInOrder[3]);
  });

  it("sorts by column value, distinct from rank/creation order", async () => {
    const viewConfig = viewConfigSchema.parse({ sort: { columnId: column.id, direction: "desc" } });

    const page = await listItemsInGroup({ organizationId: org.id, boardId: board.id, groupId: group.id, viewConfig, limit: 50 });
    // "Item 9" > "Item 8" > ... lexicographically — descending text order is
    // the reverse of creation/rank order for this fixture.
    expect(page.items.map((i) => i.id)).toEqual([...itemIdsInOrder].reverse());
  });

  it("paginates correctly when sorted by column", async () => {
    const viewConfig = viewConfigSchema.parse({ sort: { columnId: column.id, direction: "asc" } });
    const seen: string[] = [];
    let cursor: string | undefined;

    for (let guard = 0; guard < 20; guard++) {
      const page = await listItemsInGroup({ organizationId: org.id, boardId: board.id, groupId: group.id, viewConfig, cursor, limit: 4 });
      seen.push(...page.items.map((i) => i.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    expect(seen).toEqual(itemIdsInOrder);
  });

  it("returns no items for a mismatched organizationId (fails closed, not an error)", async () => {
    const page = await listItemsInGroup({
      organizationId: otherOrg.id,
      boardId: board.id,
      groupId: group.id,
      viewConfig: defaultViewConfig,
      limit: 50,
    });
    expect(page.items).toEqual([]);
  });
});
