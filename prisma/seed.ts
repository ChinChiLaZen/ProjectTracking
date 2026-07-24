import "dotenv/config";
import { prisma } from "../server/db/client";
import { runWithTenant } from "../server/db/tenantContext";
import { createColumnDefinition } from "../server/services/columnDefinitions";
import { createGroup } from "../server/services/groups";
import { createItem } from "../server/services/items";
import { setColumnValue } from "../server/services/columnValues";

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

  const board = await runWithTenant(org.id, async () => {
    const workspace = await prisma.workspace.create({
      data: { organizationId: org.id, name: "Main Workspace" },
    });

    const createdBoard = await prisma.board.create({
      data: { organizationId: org.id, workspaceId: workspace.id, name: "Getting Started" },
    });

    // Guests have no default board access — explicit membership required (§5).
    await prisma.boardMembership.create({
      data: { boardId: createdBoard.id, userId: guest.id, role: "GUEST" },
    });

    return createdBoard;
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

  console.log("Seeded:", { organizationId: org.id });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
