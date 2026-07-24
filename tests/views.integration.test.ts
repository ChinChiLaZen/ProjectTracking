import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../server/db/client";
import { runWithTenant } from "../server/db/tenantContext";
import { requireBoardAccess } from "../lib/permissions/requireBoardAccess";
import { meetsMinRole } from "../lib/permissions/matrix";
import { createBoard } from "../server/services/boards";
import { createView, deleteView, getView, listViews, updateView } from "../server/services/views";

describe("Session 7: saved views", () => {
  let org: { id: string };
  let owner: { id: string };
  let admin: { id: string };
  let member: { id: string };
  let guest: { id: string };
  let workspace: { id: string };
  let board: { id: string };

  beforeAll(async () => {
    org = await prisma.organization.create({ data: { name: "Views Org" } });
    owner = await prisma.user.create({ data: { email: "views-owner@test.dev" } });
    admin = await prisma.user.create({ data: { email: "views-admin@test.dev" } });
    member = await prisma.user.create({ data: { email: "views-member@test.dev" } });
    guest = await prisma.user.create({ data: { email: "views-guest@test.dev" } });

    await prisma.membership.createMany({
      data: [
        { organizationId: org.id, userId: owner.id, role: "OWNER" },
        { organizationId: org.id, userId: admin.id, role: "ADMIN" },
        { organizationId: org.id, userId: member.id, role: "MEMBER" },
        { organizationId: org.id, userId: guest.id, role: "GUEST" },
      ],
    });

    workspace = await runWithTenant(org.id, () => prisma.workspace.create({ data: { organizationId: org.id, name: "WS" } }));

    const { board: createdBoard } = await createBoard({
      organizationId: org.id,
      workspaceId: workspace.id,
      name: "Views Fixture Board",
      actorId: owner.id,
    });
    board = createdBoard;

    // Guests only get access via an explicit BoardMembership (§5).
    await runWithTenant(org.id, () =>
      prisma.boardMembership.create({ data: { boardId: board.id, userId: guest.id, role: "GUEST" } }),
    );
  });

  afterAll(async () => {
    await prisma.view.deleteMany({ where: { organizationId: org.id } });
    await prisma.outboxEvent.deleteMany({ where: { organizationId: org.id } });
    await prisma.activityLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.boardMembership.deleteMany({ where: { boardId: board.id } });
    await prisma.columnValue.deleteMany({ where: { organizationId: org.id } });
    await prisma.item.deleteMany({ where: { organizationId: org.id } });
    await prisma.columnDefinition.deleteMany({ where: { organizationId: org.id } });
    await prisma.group.deleteMany({ where: { organizationId: org.id } });
    await prisma.board.deleteMany({ where: { organizationId: org.id } });
    await prisma.workspace.deleteMany({ where: { organizationId: org.id } });
    await prisma.membership.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, admin.id, member.id, guest.id] } } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
  });

  describe("create/list/get/delete round trip", () => {
    it("creates a shared view and lists it", async () => {
      const view = await createView({
        organizationId: org.id,
        boardId: board.id,
        name: "My Shared View",
        visibility: "SHARED",
        config: {},
        creatorId: owner.id,
      });
      expect(view.name).toBe("My Shared View");
      expect(view.visibility).toBe("SHARED");

      const views = await listViews({ organizationId: org.id, boardId: board.id, callerId: member.id });
      expect(views.find((v) => v.id === view.id)).toBeDefined();

      const fetched = await getView({ organizationId: org.id, boardId: board.id, viewId: view.id, callerId: member.id });
      expect(fetched.id).toBe(view.id);
    });

    it("rejects invalid config against viewConfigSchema", async () => {
      await expect(
        createView({
          organizationId: org.id,
          boardId: board.id,
          name: "Bad Config",
          visibility: "SHARED",
          config: { type: "not-a-real-type" },
          creatorId: owner.id,
        }),
      ).rejects.toThrow();
    });
  });

  describe("permission split: SHARED requires ADMIN, PERSONAL requires GUEST", () => {
    it("MEMBER meets the GUEST bar for a personal view but not the ADMIN bar for a shared view", async () => {
      const { role } = await requireBoardAccess({ userId: member.id, organizationId: org.id }, board.id, "GUEST");
      expect(meetsMinRole(role, "GUEST")).toBe(true);
      expect(meetsMinRole(role, "ADMIN")).toBe(false);
    });

    it("ADMIN meets both bars", async () => {
      const { role } = await requireBoardAccess({ userId: admin.id, organizationId: org.id }, board.id, "GUEST");
      expect(meetsMinRole(role, "GUEST")).toBe(true);
      expect(meetsMinRole(role, "ADMIN")).toBe(true);
    });

    it("GUEST (via explicit BoardMembership) meets the GUEST bar", async () => {
      const { role } = await requireBoardAccess({ userId: guest.id, organizationId: org.id }, board.id, "GUEST");
      expect(meetsMinRole(role, "GUEST")).toBe(true);
      expect(meetsMinRole(role, "ADMIN")).toBe(false);
    });
  });

  describe("personal view visibility", () => {
    it("is visible to its creator via getView", async () => {
      const view = await createView({
        organizationId: org.id,
        boardId: board.id,
        name: "Member's Personal View",
        visibility: "PERSONAL",
        config: {},
        creatorId: member.id,
      });

      const fetched = await getView({ organizationId: org.id, boardId: board.id, viewId: view.id, callerId: member.id });
      expect(fetched.id).toBe(view.id);
    });

    it("404s via getView for a different, non-admin user", async () => {
      const view = await createView({
        organizationId: org.id,
        boardId: board.id,
        name: "Member's Other Personal View",
        visibility: "PERSONAL",
        config: {},
        creatorId: member.id,
      });

      await expect(
        getView({ organizationId: org.id, boardId: board.id, viewId: view.id, callerId: guest.id }),
      ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND");
    });

    // Deliberate: getView/listViews hide personal views from everyone except
    // the creator, admins included — deleteView is the only place ADMIN gets
    // an override (board-config cleanup, not a privacy grant). See the
    // service-layer comment in server/services/views.ts.
    it("404s via getView even for an ADMIN who isn't the creator", async () => {
      const view = await createView({
        organizationId: org.id,
        boardId: board.id,
        name: "Member's Third Personal View",
        visibility: "PERSONAL",
        config: {},
        creatorId: member.id,
      });

      await expect(
        getView({ organizationId: org.id, boardId: board.id, viewId: view.id, callerId: admin.id }),
      ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND");
    });

    it("is excluded from another user's listViews but included in the creator's", async () => {
      const view = await createView({
        organizationId: org.id,
        boardId: board.id,
        name: "Guest's Personal View",
        visibility: "PERSONAL",
        config: {},
        creatorId: guest.id,
      });

      const guestList = await listViews({ organizationId: org.id, boardId: board.id, callerId: guest.id });
      expect(guestList.find((v) => v.id === view.id)).toBeDefined();

      const memberList = await listViews({ organizationId: org.id, boardId: board.id, callerId: member.id });
      expect(memberList.find((v) => v.id === view.id)).toBeUndefined();
    });
  });

  describe("updateView", () => {
    it("allows the creator to update their own personal view's config", async () => {
      const view = await createView({
        organizationId: org.id,
        boardId: board.id,
        name: "Personal Draft",
        visibility: "PERSONAL",
        config: {},
        creatorId: member.id,
      });

      const updated = await updateView({
        organizationId: org.id,
        boardId: board.id,
        viewId: view.id,
        callerId: member.id,
        callerIsAdmin: false,
        config: { filters: [{ columnId: "col-1", operatorKey: "equals", args: ["x"] }] },
      });
      expect((updated.config as { filters: unknown[] }).filters).toHaveLength(1);
    });

    it("allows an ADMIN to update a SHARED view", async () => {
      const view = await createView({
        organizationId: org.id,
        boardId: board.id,
        name: "Shared Draft",
        visibility: "SHARED",
        config: {},
        creatorId: member.id,
      });

      const updated = await updateView({
        organizationId: org.id,
        boardId: board.id,
        viewId: view.id,
        callerId: admin.id,
        callerIsAdmin: true,
        name: "Renamed by Admin",
      });
      expect(updated.name).toBe("Renamed by Admin");
    });

    // Same anti-probing shape as getView: an ADMIN can't even see a personal
    // view that isn't theirs, so updateView 404s before the FORBIDDEN check
    // is ever reached — consistent with getView, not a separate rule.
    it("404s an ADMIN updating someone else's PERSONAL view (can't see it, let alone edit it)", async () => {
      const view = await createView({
        organizationId: org.id,
        boardId: board.id,
        name: "Member's Private Draft",
        visibility: "PERSONAL",
        config: {},
        creatorId: member.id,
      });

      await expect(
        updateView({
          organizationId: org.id,
          boardId: board.id,
          viewId: view.id,
          callerId: admin.id,
          callerIsAdmin: true,
          name: "Hijacked",
        }),
      ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND");
    });

    it("rejects a non-creator, non-admin MEMBER updating a SHARED view with FORBIDDEN", async () => {
      const view = await createView({
        organizationId: org.id,
        boardId: board.id,
        name: "Shared, Not Yours",
        visibility: "SHARED",
        config: {},
        creatorId: owner.id,
      });

      await expect(
        updateView({
          organizationId: org.id,
          boardId: board.id,
          viewId: view.id,
          callerId: member.id,
          callerIsAdmin: false,
          name: "Hijacked",
        }),
      ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN");
    });

    it("rejects an invalid config against viewConfigSchema", async () => {
      const view = await createView({
        organizationId: org.id,
        boardId: board.id,
        name: "To Corrupt",
        visibility: "SHARED",
        config: {},
        creatorId: owner.id,
      });

      await expect(
        updateView({
          organizationId: org.id,
          boardId: board.id,
          viewId: view.id,
          callerId: owner.id,
          callerIsAdmin: true,
          config: { type: "not-a-real-type" },
        }),
      ).rejects.toThrow();
    });
  });

  describe("deleteView", () => {
    it("allows the creator to delete their own view", async () => {
      const view = await createView({
        organizationId: org.id,
        boardId: board.id,
        name: "To Delete By Creator",
        visibility: "PERSONAL",
        config: {},
        creatorId: member.id,
      });

      const deleted = await deleteView({
        organizationId: org.id,
        boardId: board.id,
        viewId: view.id,
        callerId: member.id,
        callerIsAdmin: false,
      });
      expect(deleted.deletedAt).not.toBeNull();
    });

    it("allows an ADMIN to delete someone else's view", async () => {
      const view = await createView({
        organizationId: org.id,
        boardId: board.id,
        name: "To Delete By Admin",
        visibility: "PERSONAL",
        config: {},
        creatorId: member.id,
      });

      const deleted = await deleteView({
        organizationId: org.id,
        boardId: board.id,
        viewId: view.id,
        callerId: admin.id,
        callerIsAdmin: true,
      });
      expect(deleted.deletedAt).not.toBeNull();
    });

    it("rejects an unrelated non-admin caller with FORBIDDEN", async () => {
      const view = await createView({
        organizationId: org.id,
        boardId: board.id,
        name: "Not Yours",
        visibility: "PERSONAL",
        config: {},
        creatorId: member.id,
      });

      await expect(
        deleteView({ organizationId: org.id, boardId: board.id, viewId: view.id, callerId: guest.id, callerIsAdmin: false }),
      ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN");
    });
  });

  describe("tenant isolation", () => {
    it("getView 404s for a viewId from another org", async () => {
      const otherOrg = await prisma.organization.create({ data: { name: "Other Views Org" } });
      const otherWorkspace = await runWithTenant(otherOrg.id, () =>
        prisma.workspace.create({ data: { organizationId: otherOrg.id, name: "Other WS" } }),
      );
      const { board: otherBoard } = await createBoard({
        organizationId: otherOrg.id,
        workspaceId: otherWorkspace.id,
        name: "Other Org Board",
        actorId: owner.id,
      });

      const otherView = await createView({
        organizationId: otherOrg.id,
        boardId: otherBoard.id,
        name: "Other Org View",
        visibility: "SHARED",
        config: {},
        creatorId: owner.id,
      });

      // Same viewId, but scoped to the wrong org/board — must 404, not leak.
      await expect(
        getView({ organizationId: org.id, boardId: board.id, viewId: otherView.id, callerId: owner.id }),
      ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND");

      await prisma.view.deleteMany({ where: { organizationId: otherOrg.id } });
      await prisma.outboxEvent.deleteMany({ where: { organizationId: otherOrg.id } });
      await prisma.activityLog.deleteMany({ where: { organizationId: otherOrg.id } });
      await prisma.group.deleteMany({ where: { organizationId: otherOrg.id } });
      await prisma.board.deleteMany({ where: { organizationId: otherOrg.id } });
      await prisma.workspace.deleteMany({ where: { organizationId: otherOrg.id } });
      await prisma.organization.deleteMany({ where: { id: otherOrg.id } });
    });
  });
});
