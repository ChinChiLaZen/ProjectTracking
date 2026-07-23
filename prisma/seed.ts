import "dotenv/config";
import { prisma } from "../server/db/client";
import { runWithTenant } from "../server/db/tenantContext";

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

  await runWithTenant(org.id, async () => {
    const workspace = await prisma.workspace.create({
      data: { organizationId: org.id, name: "Main Workspace" },
    });

    const board = await prisma.board.create({
      data: { organizationId: org.id, workspaceId: workspace.id, name: "Getting Started" },
    });

    // Guests have no default board access — explicit membership required (§5).
    await prisma.boardMembership.create({
      data: { boardId: board.id, userId: guest.id, role: "GUEST" },
    });
  });

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
