import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../server/db/client";
import { runWithTenant } from "../server/db/tenantContext";
import { createGroup } from "../server/services/groups";
import { createColumnDefinition } from "../server/services/columnDefinitions";
import { createItem, listItemsInDateRange } from "../server/services/items";
import { setColumnValue } from "../server/services/columnValues";
import { defaultViewConfig } from "../lib/views/viewConfig";

describe("listItemsInDateRange (Session 10 gate: boardwide date-range query)", () => {
  let org: { id: string };
  let user: { id: string };
  let board: { id: string };
  let groupA: { id: string };
  let groupB: { id: string };
  let dateColumn: { id: string };
  let otherDateColumn: { id: string };
  let statusColumn: { id: string };

  let beforeRangeItem: { id: string };
  let atStartItem: { id: string };
  let midRangeItem: { id: string };
  let atEndItem: { id: string };
  let afterRangeItem: { id: string };
  let noValueItem: { id: string };
  let wrongColumnItem: { id: string };
  let filteredOutItem: { id: string };

  beforeAll(async () => {
    org = await prisma.organization.create({ data: { name: "DateRange Org" } });
    user = await prisma.user.create({ data: { email: "daterange-user@test.dev" } });
    await prisma.membership.create({ data: { organizationId: org.id, userId: user.id, role: "OWNER" } });

    board = await runWithTenant(org.id, async () => {
      const workspace = await prisma.workspace.create({ data: { organizationId: org.id, name: "WS" } });
      return prisma.board.create({ data: { organizationId: org.id, workspaceId: workspace.id, name: "Board" } });
    });

    // Two groups — the point of this query is that it spans both, unlike
    // listItemsInGroup which is scoped to one.
    groupA = await createGroup({ organizationId: org.id, boardId: board.id, name: "Group A", actorId: user.id });
    groupB = await createGroup({ organizationId: org.id, boardId: board.id, name: "Group B", actorId: user.id });

    dateColumn = await createColumnDefinition({ organizationId: org.id, boardId: board.id, key: "date", name: "Due date" });
    otherDateColumn = await createColumnDefinition({ organizationId: org.id, boardId: board.id, key: "date", name: "Start date" });
    statusColumn = await createColumnDefinition({
      organizationId: org.id,
      boardId: board.id,
      key: "status",
      name: "Status",
      settings: { options: [{ id: "done", label: "Done", color: "#0c0", order: 0 }] },
    });

    async function makeItem(groupId: string, name: string) {
      return createItem({ organizationId: org.id, boardId: board.id, groupId, name, actorId: user.id });
    }
    async function setDate(itemId: string, columnId: string, value: string) {
      await setColumnValue({ organizationId: org.id, boardId: board.id, itemId, columnId, value, expectedVersion: 0, actorId: user.id });
    }

    beforeRangeItem = await makeItem(groupA.id, "Before range");
    await setDate(beforeRangeItem.id, dateColumn.id, "2026-02-27");

    atStartItem = await makeItem(groupB.id, "At range start"); // different group on purpose
    await setDate(atStartItem.id, dateColumn.id, "2026-03-01");

    midRangeItem = await makeItem(groupA.id, "Mid range");
    await setDate(midRangeItem.id, dateColumn.id, "2026-03-15");

    atEndItem = await makeItem(groupB.id, "At range end");
    await setDate(atEndItem.id, dateColumn.id, "2026-03-31");

    afterRangeItem = await makeItem(groupA.id, "After range");
    await setDate(afterRangeItem.id, dateColumn.id, "2026-04-02");

    noValueItem = await makeItem(groupA.id, "No date value");

    wrongColumnItem = await makeItem(groupA.id, "Wrong column");
    await setDate(wrongColumnItem.id, otherDateColumn.id, "2026-03-15");

    filteredOutItem = await makeItem(groupA.id, "Filtered out by status");
    await setDate(filteredOutItem.id, dateColumn.id, "2026-03-15");
    // No status value set — a filter for status=done should exclude it.
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

  const rangeStart = new Date("2026-03-01T00:00:00Z");
  const rangeEnd = new Date("2026-03-31T23:59:59Z");

  it("includes items within the range from every group, boundary-inclusive", async () => {
    const result = await listItemsInDateRange({
      organizationId: org.id,
      boardId: board.id,
      dateColumnId: dateColumn.id,
      rangeStart,
      rangeEnd,
      viewConfig: defaultViewConfig,
    });

    const ids = result.items.map((i) => i.id);
    expect(ids).toContain(atStartItem.id);
    expect(ids).toContain(midRangeItem.id);
    expect(ids).toContain(atEndItem.id);
  });

  it("excludes items outside the range", async () => {
    const result = await listItemsInDateRange({
      organizationId: org.id,
      boardId: board.id,
      dateColumnId: dateColumn.id,
      rangeStart,
      rangeEnd,
      viewConfig: defaultViewConfig,
    });

    const ids = result.items.map((i) => i.id);
    expect(ids).not.toContain(beforeRangeItem.id);
    expect(ids).not.toContain(afterRangeItem.id);
  });

  it("excludes items with no value for the date column", async () => {
    const result = await listItemsInDateRange({
      organizationId: org.id,
      boardId: board.id,
      dateColumnId: dateColumn.id,
      rangeStart,
      rangeEnd,
      viewConfig: defaultViewConfig,
    });

    expect(result.items.map((i) => i.id)).not.toContain(noValueItem.id);
  });

  it("excludes items whose matching date is on a different column", async () => {
    const result = await listItemsInDateRange({
      organizationId: org.id,
      boardId: board.id,
      dateColumnId: dateColumn.id,
      rangeStart,
      rangeEnd,
      viewConfig: defaultViewConfig,
    });

    expect(result.items.map((i) => i.id)).not.toContain(wrongColumnItem.id);
  });

  it("respects additional viewConfig filters (ANDed with the date range)", async () => {
    const result = await listItemsInDateRange({
      organizationId: org.id,
      boardId: board.id,
      dateColumnId: dateColumn.id,
      rangeStart,
      rangeEnd,
      viewConfig: { ...defaultViewConfig, filters: [{ columnId: statusColumn.id, operatorKey: "equals", args: ["done"] }] },
    });

    // Nobody in range has status=done set, so the filtered query returns none
    // of the in-range items — proves the filter is actually applied, not
    // silently ignored.
    const ids = result.items.map((i) => i.id);
    expect(ids).not.toContain(midRangeItem.id);
    expect(ids).not.toContain(filteredOutItem.id);
  });

  it("rejects a cross-org boardId with an empty result, not a leak", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other DateRange Org" } });
    await expect(
      listItemsInDateRange({
        organizationId: otherOrg.id,
        boardId: board.id, // belongs to `org`, not `otherOrg`
        dateColumnId: dateColumn.id,
        rangeStart,
        rangeEnd,
        viewConfig: defaultViewConfig,
      }),
    ).resolves.toEqual({ items: [], values: [] });
    await prisma.organization.deleteMany({ where: { id: otherOrg.id } });
  });
});
