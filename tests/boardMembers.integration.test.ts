import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../server/db/client";
import { runWithTenant } from "../server/db/tenantContext";
import { createBoard } from "../server/services/boards";
import { listBoardMembers } from "../server/services/boardMembers";

describe("Session 14: listBoardMembers", () => {
  let org: { id: string };
  let owner: { id: string };
  let admin: { id: string };
  let guestWithAccess: { id: string };
  let guestWithoutAccess: { id: string };
  let workspace: { id: string };
  let board: { id: string };

  beforeAll(async () => {
    org = await prisma.organization.create({ data: { name: "BoardMembers Org" } });
    owner = await prisma.user.create({ data: { email: "bm-owner@test.dev", name: "Olivia Owner" } });
    admin = await prisma.user.create({ data: { email: "bm-admin@test.dev", name: "Adam Admin" } });
    guestWithAccess = await prisma.user.create({ data: { email: "bm-guest-in@test.dev", name: "Gina Guest" } });
    guestWithoutAccess = await prisma.user.create({ data: { email: "bm-guest-out@test.dev", name: "Gary Guest" } });

    await prisma.membership.createMany({
      data: [
        { organizationId: org.id, userId: owner.id, role: "OWNER" },
        { organizationId: org.id, userId: admin.id, role: "ADMIN" },
        { organizationId: org.id, userId: guestWithAccess.id, role: "GUEST" },
        { organizationId: org.id, userId: guestWithoutAccess.id, role: "GUEST" },
      ],
    });

    workspace = await runWithTenant(org.id, () => prisma.workspace.create({ data: { organizationId: org.id, name: "WS" } }));

    const { board: createdBoard } = await createBoard({
      organizationId: org.id,
      workspaceId: workspace.id,
      name: "Members Fixture Board",
      actorId: owner.id,
    });
    board = createdBoard;

    await runWithTenant(org.id, () =>
      prisma.boardMembership.create({ data: { boardId: board.id, userId: guestWithAccess.id, role: "GUEST" } }),
    );
  });

  afterAll(async () => {
    await prisma.boardMembership.deleteMany({ where: { boardId: board.id } });
    await prisma.board.deleteMany({ where: { organizationId: org.id } });
    await prisma.workspace.deleteMany({ where: { organizationId: org.id } });
    await prisma.membership.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, admin.id, guestWithAccess.id, guestWithoutAccess.id] } } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
  });

  it("includes org members with a default (non-GUEST) role", async () => {
    const members = await listBoardMembers({ organizationId: org.id, boardId: board.id });
    const ids = members.map((m) => m.userId);
    expect(ids).toContain(owner.id);
    expect(ids).toContain(admin.id);
  });

  it("excludes a GUEST with no explicit BoardMembership", async () => {
    const members = await listBoardMembers({ organizationId: org.id, boardId: board.id });
    expect(members.map((m) => m.userId)).not.toContain(guestWithoutAccess.id);
  });

  it("includes a GUEST who has an explicit BoardMembership", async () => {
    const members = await listBoardMembers({ organizationId: org.id, boardId: board.id });
    const guestEntry = members.find((m) => m.userId === guestWithAccess.id);
    expect(guestEntry).toBeDefined();
    expect(guestEntry?.role).toBe("GUEST");
  });

  it("resolves name/email/image for each member", async () => {
    const members = await listBoardMembers({ organizationId: org.id, boardId: board.id });
    const ownerEntry = members.find((m) => m.userId === owner.id);
    expect(ownerEntry?.name).toBe("Olivia Owner");
    expect(ownerEntry?.email).toBe("bm-owner@test.dev");
  });

  it("board-level role overrides the org-level default when both exist", async () => {
    // Downgrade admin's effective board role via an explicit BoardMembership override.
    await runWithTenant(org.id, () =>
      prisma.boardMembership.create({ data: { boardId: board.id, userId: admin.id, role: "MEMBER" } }),
    );
    const members = await listBoardMembers({ organizationId: org.id, boardId: board.id });
    const adminEntry = members.find((m) => m.userId === admin.id);
    expect(adminEntry?.role).toBe("MEMBER");
    await runWithTenant(org.id, () =>
      prisma.boardMembership.deleteMany({ where: { boardId: board.id, userId: admin.id } }),
    );
  });

  it("cross-org board id returns an empty result, not a leak", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other BoardMembers Org" } });
    const members = await listBoardMembers({ organizationId: otherOrg.id, boardId: board.id });
    expect(members).toEqual([]);
    await prisma.organization.deleteMany({ where: { id: otherOrg.id } });
  });
});
