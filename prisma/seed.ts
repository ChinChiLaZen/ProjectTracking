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
import { createUpdate } from "../server/services/updates";
import { deliverMentionEmails } from "../server/services/notificationRelay";
import { createAttachment } from "../server/services/attachments";
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

  const todoItems: { id: string; name: string }[] = [];
  for (const name of ["Kick off project", "Draft plan", "Review with stakeholders"]) {
    const item = await createItem({
      organizationId: org.id,
      boardId: board.id,
      groupId: todoGroup.id,
      name,
      actorId: owner.id,
    });
    todoItems.push(item);

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
  // Session 11 fixtures: dropdown + timeline column types.
  const priorityColumnDef = await createColumnDefinition({
    organizationId: org.id,
    boardId: board.id,
    key: "dropdown",
    name: "Priority",
    settings: {
      options: [
        { id: "low", label: "Low", order: 0 },
        { id: "medium", label: "Medium", order: 1 },
        { id: "high", label: "High", color: "#c00", order: 2 },
      ],
    },
  });
  const timelineColumnDef = await createColumnDefinition({ organizationId: org.id, boardId: board.id, key: "timeline", name: "Project window" });

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

  // Session 10 fixture: a couple more Due dates on the existing "To Do"
  // items — previously only demoItem had a date value, leaving the
  // Calendar view with a single populated day to look at.
  await setColumnValue({ organizationId: org.id, boardId: board.id, itemId: todoItems[0]!.id, columnId: dateColumnDef.id, value: "2026-08-03", expectedVersion: 0, actorId: owner.id });
  await setColumnValue({ organizationId: org.id, boardId: board.id, itemId: todoItems[1]!.id, columnId: dateColumnDef.id, value: "2026-08-03", expectedVersion: 0, actorId: owner.id });
  await setColumnValue({ organizationId: org.id, boardId: board.id, itemId: todoItems[2]!.id, columnId: dateColumnDef.id, value: "2026-08-10", expectedVersion: 0, actorId: owner.id });
  await setColumnValue({ organizationId: org.id, boardId: board.id, itemId: demoItem.id, columnId: numberColumnDef.id, value: 5, expectedVersion: 0, actorId: owner.id });
  await setColumnValue({ organizationId: org.id, boardId: board.id, itemId: demoItem.id, columnId: priorityColumnDef.id, value: "high", expectedVersion: 0, actorId: owner.id });
  await setColumnValue({ organizationId: org.id, boardId: board.id, itemId: demoItem.id, columnId: timelineColumnDef.id, value: { start: "2026-08-01", end: "2026-08-07" }, expectedVersion: 0, actorId: owner.id });
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

  // Session 13 fixture: a couple of comments on the demo item — proves the
  // create+list mechanism against real seeded data.
  await createUpdate({ organizationId: org.id, boardId: board.id, itemId: demoItem.id, authorId: owner.id, body: "Kicking off the review — please add your notes here." });
  await createUpdate({ organizationId: org.id, boardId: board.id, itemId: demoItem.id, authorId: member.id, body: "Looks good so far, just double-checking the timeline." });

  // Session 14 fixture: a comment carrying a real @mention token — proves
  // the parse/validate/store/render path against real seeded data.
  await createUpdate({
    organizationId: org.id,
    boardId: board.id,
    itemId: demoItem.id,
    authorId: owner.id,
    body: `@[${member.name ?? member.email}](${member.id}) can you take a look at this when you get a chance?`,
  });

  // Session 16 fixture: a real, valid 1x1 PNG attached to the demo item —
  // proves the validate/store/download path against real seeded data
  // (local-disk adapter in dev by default, since S3_BUCKET is unset here).
  await createAttachment({
    organizationId: org.id,
    boardId: board.id,
    itemId: demoItem.id,
    uploaderId: owner.id,
    fileName: "demo.png",
    mimeType: "image/png",
    body: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
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

  // Session 8 fixture: a second view with a real, non-default filter —
  // proves the filter/sort-builder's compiled config against real seeded
  // data, not just the empty default every Session 7 view had.
  await createView({
    organizationId: org.id,
    boardId: board.id,
    name: "In Progress only",
    visibility: "SHARED",
    config: { filters: [{ columnId: statusColumnDef.id, operatorKey: "equals", args: ["doing"] }] },
    creatorId: owner.id,
  });

  // Session 9 fixture: a Kanban-mode view grouped by Status — proves the
  // saved-view round trip for viewConfig.type/groupBy against real data.
  await createView({
    organizationId: org.id,
    boardId: board.id,
    name: "By status (Kanban)",
    visibility: "SHARED",
    config: { type: "kanban", groupBy: statusColumnDef.id },
    creatorId: owner.id,
  });

  // Session 10 fixture: a Calendar-mode view keyed on Due date — proves the
  // saved-view round trip for viewConfig.type/dateColumnId against real data.
  await createView({
    organizationId: org.id,
    boardId: board.id,
    name: "By due date (Calendar)",
    visibility: "SHARED",
    config: { type: "calendar", dateColumnId: dateColumnDef.id },
    creatorId: owner.id,
  });

  const bigBoardStart = performance.now();
  await runWithTenant(org.id, () => seedBigBoard({ organizationId: org.id, workspaceId: workspace.id }));
  const bigBoardMs = Math.round(performance.now() - bigBoardStart);

  // Session 15 fixture: run the (still-unscheduled) email relay once here
  // so `pnpm db:seed` proves the whole mention -> email path against the
  // Session 14 mention fixture above, with zero new seed code — a free
  // second reader of a fixture that already exists (same "second reader for
  // free" precedent as the activity feed reading Update rows in Session 13).
  const relayResult = await deliverMentionEmails();

  console.log("Seeded:", { organizationId: org.id, bigBoardMs, relayResult });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
