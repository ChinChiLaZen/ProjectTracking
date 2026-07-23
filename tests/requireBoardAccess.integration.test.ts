import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireBoardAccess } from "../lib/permissions/requireBoardAccess";
import { prisma } from "../server/db/client";
import { runWithTenant } from "../server/db/tenantContext";

describe("requireBoardAccess — tenant isolation (Session 1 gate)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let ownerA: { id: string };
  let memberA: { id: string };
  let guestA: { id: string };
  let boardA: { id: string };
  let boardB: { id: string };

  beforeAll(async () => {
    orgA = await prisma.organization.create({ data: { name: "Org A" } });
    orgB = await prisma.organization.create({ data: { name: "Org B" } });

    ownerA = await prisma.user.create({ data: { email: "owner-a@test.dev" } });
    memberA = await prisma.user.create({ data: { email: "member-a@test.dev" } });
    guestA = await prisma.user.create({ data: { email: "guest-a@test.dev" } });

    await prisma.membership.createMany({
      data: [
        { organizationId: orgA.id, userId: ownerA.id, role: "OWNER" },
        { organizationId: orgA.id, userId: memberA.id, role: "MEMBER" },
        { organizationId: orgA.id, userId: guestA.id, role: "GUEST" },
      ],
    });

    boardA = await runWithTenant(orgA.id, async () => {
      const workspace = await prisma.workspace.create({ data: { organizationId: orgA.id, name: "WS A" } });
      return prisma.board.create({ data: { organizationId: orgA.id, workspaceId: workspace.id, name: "Board A" } });
    });

    boardB = await runWithTenant(orgB.id, async () => {
      const workspace = await prisma.workspace.create({ data: { organizationId: orgB.id, name: "WS B" } });
      return prisma.board.create({ data: { organizationId: orgB.id, workspaceId: workspace.id, name: "Board B" } });
    });
  });

  afterAll(async () => {
    await prisma.boardMembership.deleteMany({ where: { userId: { in: [ownerA.id, memberA.id, guestA.id] } } });
    await prisma.board.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.workspace.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.membership.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerA.id, memberA.id, guestA.id] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  });

  it("grants access to a board within the caller's own org", async () => {
    const { role } = await requireBoardAccess({ userId: ownerA.id, organizationId: orgA.id }, boardA.id, "MEMBER");
    expect(role).toBe("OWNER");
  });

  it("returns NOT_FOUND for a board belonging to a different org — never FORBIDDEN", async () => {
    await expect(
      requireBoardAccess({ userId: ownerA.id, organizationId: orgA.id }, boardB.id, "MEMBER"),
    ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND");
  });

  it("returns FORBIDDEN when the org role is below minRole", async () => {
    await expect(
      requireBoardAccess({ userId: memberA.id, organizationId: orgA.id }, boardA.id, "ADMIN"),
    ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN");
  });

  it("denies a GUEST with no explicit BoardMembership, even within their own org", async () => {
    await expect(
      requireBoardAccess({ userId: guestA.id, organizationId: orgA.id }, boardA.id, "GUEST"),
    ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN");
  });

  it("grants a GUEST access once explicitly added to the board", async () => {
    await prisma.boardMembership.create({ data: { boardId: boardA.id, userId: guestA.id, role: "GUEST" } });
    const { role } = await requireBoardAccess({ userId: guestA.id, organizationId: orgA.id }, boardA.id, "GUEST");
    expect(role).toBe("GUEST");
  });
});
