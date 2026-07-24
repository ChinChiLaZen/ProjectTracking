import "dotenv/config";
import { createId } from "@paralleldrive/cuid2";
import { generateNKeysBetween } from "fractional-indexing";
import { prisma } from "../server/db/client";
import { runWithTenant } from "../server/db/tenantContext";
import { createColumnDefinition } from "../server/services/columnDefinitions";
import { createGroup } from "../server/services/groups";
import { createItem } from "../server/services/items";
import { setColumnValue } from "../server/services/columnValues";
import { createView } from "../server/services/views";
import { textColumn } from "../lib/columnTypes/text";
import type { Prisma } from "../generated/prisma/client";

const BIG_BOARD_TOTAL_ITEMS = 10_000;
const BIG_BOARD_GROUP_NAMES = ["Backlog", "In Progress", "Review", "Done"];
const BIG_BOARD_COLUMN_NAMES = ["Title", "Description", "Owner", "Notes", "Tags"];
const SEED_BATCH_SIZE = 1000;

// Session 4: the 10k-item perf-fixture board. Bulk-inserted (createMany),
// bypassing createItem/setColumnValue and their ActivityLog/OutboxEvent
// writes — a deliberate, scoped exception to "seed goes through the
// service layer." Routing 10k items x 5 column writes through those
// services (each several round trips, one with a row lock, one re-fetching
// every sibling column/value) would take minutes-to-tens-of-minutes for
// synthetic data with no audit trail worth having. Every other seed
// fixture keeps using the service layer.
async function seedBigBoard(params: { organizationId: string; workspaceId: string }) {
  const { organizationId, workspaceId } = params;

  const board = await prisma.board.create({
    data: { organizationId, workspaceId, name: "10k Items" },
  });

  const groupRanks = generateNKeysBetween(null, null, BIG_BOARD_GROUP_NAMES.length);
  const groups = await Promise.all(
    BIG_BOARD_GROUP_NAMES.map((name, i) =>
      prisma.group.create({ data: { organizationId, boardId: board.id, name, rank: groupRanks[i]! } }),
    ),
  );

  const columnRanks = generateNKeysBetween(null, null, BIG_BOARD_COLUMN_NAMES.length);
  const columns = await Promise.all(
    BIG_BOARD_COLUMN_NAMES.map((name, i) =>
      prisma.columnDefinition.create({
        data: { organizationId, boardId: board.id, key: "text", name, settings: {}, rank: columnRanks[i]! },
      }),
    ),
  );

  const itemsPerGroup = BIG_BOARD_TOTAL_ITEMS / groups.length;
  let itemNumber = 1;

  for (const group of groups) {
    const ranks = generateNKeysBetween(null, null, itemsPerGroup);

    for (let batchStart = 0; batchStart < itemsPerGroup; batchStart += SEED_BATCH_SIZE) {
      const batchRanks = ranks.slice(batchStart, batchStart + SEED_BATCH_SIZE);

      // Explicit `id` (rather than letting Prisma's cuid(2) default fill it
      // in) so ColumnValue rows below can reference itemId without a
      // round trip to read the created rows back.
      const itemRows = batchRanks.map((rank) => {
        const id = createId();
        const number = itemNumber;
        itemNumber += 1;
        return {
          id,
          organizationId,
          boardId: board.id,
          groupId: group.id,
          number,
          name: `Item ${number}`,
          rank,
          version: 1,
        };
      });

      await prisma.item.createMany({ data: itemRows });

      const valueRows: Prisma.ColumnValueCreateManyInput[] = itemRows.flatMap((item) =>
        columns.map((column) => {
          const value = `${column.name} for ${item.name}`;
          const shadow = textColumn.toShadow({
            value,
            settings: {},
            item: { id: item.id, boardId: board.id, groupId: item.groupId },
            valuesByColumnId: {},
            columnsById: {},
            timeZone: "UTC",
          });
          return {
            id: createId(),
            itemId: item.id,
            columnId: column.id,
            organizationId,
            boardId: board.id,
            value,
            version: 1,
            ...shadow,
          };
        }),
      );

      await prisma.columnValue.createMany({ data: valueRows });
    }
  }

  return board;
}

async function main() {
  const org = await prisma.organization.create({ data: { name: "Acme Inc" } });

  const [owner, admin, member, guest] = await Promise.all([
    prisma.user.create({ data: { email: "owner@acme.test", name: "Olivia Owner" } }),
    prisma.user.create({ data: { email: "admin@acme.test", name: "Aiden Admin" } }),
    prisma.user.create({ data: { email: "member@acme.test", name: "Mia Member" } }),
    prisma.user.create({ data: { email: "guest@acme.test", name: "Gabe Guest" } }),
  ]);

  await prisma.membership.createMany({
    data: [
      { organizationId: org.id, userId: owner.id, role: "OWNER" },
      { organizationId: org.id, userId: admin.id, role: "ADMIN" },
      { organizationId: org.id, userId: member.id, role: "MEMBER" },
      { organizationId: org.id, userId: guest.id, role: "GUEST" },
    ],
  });

  const { board, workspace } = await runWithTenant(org.id, async () => {
    const createdWorkspace = await prisma.workspace.create({
      data: { organizationId: org.id, name: "Main Workspace" },
    });

    const createdBoard = await prisma.board.create({
      data: { organizationId: org.id, workspaceId: createdWorkspace.id, name: "Getting Started" },
    });

    // Guests have no default board access — explicit membership required (§5).
    await prisma.boardMembership.create({
      data: { boardId: createdBoard.id, userId: guest.id, role: "GUEST" },
    });

    return { board: createdBoard, workspace: createdWorkspace };
  });

  // Session 2 vertical slice fixture: one `text` column, one group, a few
  // items with values — routed through the same service layer a real user
  // action takes (§6.1: fixtures shouldn't take a bulk raw-SQL shortcut).
  const taskNameColumn = await createColumnDefinition({
    organizationId: org.id,
    boardId: board.id,
    key: "text",
    name: "Task name",
  });

  const todoGroup = await createGroup({
    organizationId: org.id,
    boardId: board.id,
    name: "To Do",
    actorId: owner.id,
  });

  for (const name of ["Kick off project", "Draft plan", "Review with stakeholders"]) {
    const item = await createItem({
      organizationId: org.id,
      boardId: board.id,
      groupId: todoGroup.id,
      name,
      actorId: owner.id,
    });

    await setColumnValue({
      organizationId: org.id,
      boardId: board.id,
      itemId: item.id,
      columnId: taskNameColumn.id,
      value: name,
      expectedVersion: 0,
      actorId: owner.id,
    });
  }

  // Session 5 fixture: one column per new type + a representative value on
  // a dedicated item — §4.3's "column type is done" checklist requires a
  // seed row per type. Routed through the service layer (small, ordinary
  // writes — not the 10k-board's bulk-insert exception below).
  const statusColumnDef = await createColumnDefinition({
    organizationId: org.id,
    boardId: board.id,
    key: "status",
    name: "Status",
    settings: {
      options: [
        { id: "todo", label: "To Do", color: "#ccc", order: 0 },
        { id: "doing", label: "In Progress", color: "#fc0", order: 1 },
        { id: "done", label: "Done", color: "#0c0", order: 2 },
      ],
    },
  });
  const personColumnDef = await createColumnDefinition({ organizationId: org.id, boardId: board.id, key: "person", name: "Assignee" });
  const dateColumnDef = await createColumnDefinition({ organizationId: org.id, boardId: board.id, key: "date", name: "Due date" });
  const numberColumnDef = await createColumnDefinition({ organizationId: org.id, boardId: board.id, key: "number", name: "Estimate" });
  const checkboxColumnDef = await createColumnDefinition({ organizationId: org.id, boardId: board.id, key: "checkbox", name: "Done?" });
  const longTextColumnDef = await createColumnDefinition({ organizationId: org.id, boardId: board.id, key: "long_text", name: "Notes" });

  const demoItem = await createItem({
    organizationId: org.id,
    boardId: board.id,
    groupId: todoGroup.id,
    name: "Demo item (all column types)",
    actorId: owner.id,
  });

  await setColumnValue({ organizationId: org.id, boardId: board.id, itemId: demoItem.id, columnId: statusColumnDef.id, value: "doing", expectedVersion: 0, actorId: owner.id });
  await setColumnValue({ organizationId: org.id, boardId: board.id, itemId: demoItem.id, columnId: personColumnDef.id, value: [owner.id, member.id], expectedVersion: 0, actorId: owner.id });
  await setColumnValue({ organizationId: org.id, boardId: board.id, itemId: demoItem.id, columnId: dateColumnDef.id, value: "2026-08-01", expectedVersion: 0, actorId: owner.id });
  await setColumnValue({ organizationId: org.id, boardId: board.id, itemId: demoItem.id, columnId: numberColumnDef.id, value: 5, expectedVersion: 0, actorId: owner.id });
  await setColumnValue({ organizationId: org.id, boardId: board.id, itemId: demoItem.id, columnId: checkboxColumnDef.id, value: false, expectedVersion: 0, actorId: owner.id });
  await setColumnValue({
    organizationId: org.id,
    boardId: board.id,
    itemId: demoItem.id,
    columnId: longTextColumnDef.id,
    value: "Multi-line notes go here.\nSecond line.",
    expectedVersion: 0,
    actorId: owner.id,
  });

  // Session 7 fixture: one shared saved view (default config) on the
  // "Getting Started" board — §9's "every new feature adds its fixture
  // here", and proves the shareable-URL path against real seeded data.
  await createView({
    organizationId: org.id,
    boardId: board.id,
    name: "All items",
    visibility: "SHARED",
    config: {},
    creatorId: owner.id,
  });

  const bigBoardStart = performance.now();
  await runWithTenant(org.id, () => seedBigBoard({ organizationId: org.id, workspaceId: workspace.id }));
  const bigBoardMs = Math.round(performance.now() - bigBoardStart);

  console.log("Seeded:", { organizationId: org.id, bigBoardMs });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
