import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../server/db/client";
import { runWithTenant } from "../server/db/tenantContext";
import { createBoard } from "../server/services/boards";
import { createGroup } from "../server/services/groups";
import { createItem } from "../server/services/items";
import { createUpdate, deleteUpdate, listUpdates } from "../server/services/updates";

describe("Session 13: item updates/comments", () => {
  let org: { id: string };
  let owner: { id: string; email: string };
  let admin: { id: string; email: string };
  let member: { id: string; email: string };
  let guest: { id: string; email: string };
  let workspace: { id: string };
  let board: { id: string };
  let group: { id: string };
  let item: { id: string };

  beforeAll(async () => {
    org = await prisma.organization.create({ data: { name: "Updates Org" } });
    owner = await prisma.user.create({ data: { email: "updates-owner@test.dev" } });
    admin = await prisma.user.create({ data: { email: "updates-admin@test.dev" } });
    member = await prisma.user.create({ data: { email: "updates-member@test.dev" } });
    guest = await prisma.user.create({ data: { email: "updates-guest@test.dev" } });

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
      name: "Updates Fixture Board",
      actorId: owner.id,
    });
    board = createdBoard;

    await runWithTenant(org.id, () =>
      prisma.boardMembership.create({ data: { boardId: board.id, userId: guest.id, role: "GUEST" } }),
    );

    group = await createGroup({ organizationId: org.id, boardId: board.id, name: "Group", actorId: owner.id });
    item = await createItem({ organizationId: org.id, boardId: board.id, groupId: group.id, name: "Item", actorId: owner.id });
  });

  afterAll(async () => {
    await prisma.outboxEvent.deleteMany({ where: { organizationId: org.id } });
    await prisma.activityLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.update.deleteMany({ where: { organizationId: org.id } });
    await prisma.item.deleteMany({ where: { organizationId: org.id } });
    await prisma.group.deleteMany({ where: { organizationId: org.id } });
    await prisma.boardMembership.deleteMany({ where: { boardId: board.id } });
    await prisma.board.deleteMany({ where: { organizationId: org.id } });
    await prisma.workspace.deleteMany({ where: { organizationId: org.id } });
    await prisma.membership.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, admin.id, member.id, guest.id] } } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
  });

  it("creates a comment and lists it back", async () => {
    const created = await createUpdate({ organizationId: org.id, boardId: board.id, itemId: item.id, authorId: owner.id, body: "First comment" });
    expect(created.body).toBe("First comment");
    expect(created.authorId).toBe(owner.id);

    const page = await listUpdates({ organizationId: org.id, boardId: board.id, itemId: item.id });
    expect(page.entries.map((e) => e.id)).toContain(created.id);
  });

  it("lists comments chronologically (oldest first)", async () => {
    const freshItem = await createItem({ organizationId: org.id, boardId: board.id, groupId: group.id, name: "Chrono Item", actorId: owner.id });
    const first = await createUpdate({ organizationId: org.id, boardId: board.id, itemId: freshItem.id, authorId: owner.id, body: "one" });
    const second = await createUpdate({ organizationId: org.id, boardId: board.id, itemId: freshItem.id, authorId: owner.id, body: "two" });

    const page = await listUpdates({ organizationId: org.id, boardId: board.id, itemId: freshItem.id });
    expect(page.entries.map((e) => e.id)).toEqual([first.id, second.id]);
  });

  it("a GUEST can comment on a board they're an explicit member of", async () => {
    const created = await createUpdate({ organizationId: org.id, boardId: board.id, itemId: item.id, authorId: guest.id, body: "guest comment" });
    expect(created.authorId).toBe(guest.id);
  });

  it("rejects creating a comment on an item that doesn't belong to the given board", async () => {
    const otherBoard = await runWithTenant(org.id, () =>
      prisma.board.create({ data: { organizationId: org.id, workspaceId: workspace.id, name: "Other Board" } }),
    );
    await expect(
      createUpdate({ organizationId: org.id, boardId: otherBoard.id, itemId: item.id, authorId: owner.id, body: "wrong board" }),
    ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND");
    await prisma.board.deleteMany({ where: { id: otherBoard.id } });
  });

  it("writes ActivityLog and OutboxEvent rows on create", async () => {
    const created = await createUpdate({ organizationId: org.id, boardId: board.id, itemId: item.id, authorId: owner.id, body: "logged comment" });

    const log = await prisma.activityLog.findFirst({ where: { organizationId: org.id, type: "item.update_created", payload: { path: ["updateId"], equals: created.id } } });
    expect(log).not.toBeNull();

    const outbox = await prisma.outboxEvent.findFirst({ where: { organizationId: org.id, type: "item.update_created", payload: { path: ["updateId"], equals: created.id } } });
    expect(outbox).not.toBeNull();
  });

  describe("deleteUpdate", () => {
    it("allows the author to delete their own comment", async () => {
      const created = await createUpdate({ organizationId: org.id, boardId: board.id, itemId: item.id, authorId: member.id, body: "delete me" });
      const deleted = await deleteUpdate({ organizationId: org.id, boardId: board.id, updateId: created.id, callerId: member.id, callerIsAdmin: false });
      expect(deleted.id).toBe(created.id);

      const page = await listUpdates({ organizationId: org.id, boardId: board.id, itemId: item.id });
      expect(page.entries.map((e) => e.id)).not.toContain(created.id);
    });

    it("allows an ADMIN to delete someone else's comment", async () => {
      const created = await createUpdate({ organizationId: org.id, boardId: board.id, itemId: item.id, authorId: member.id, body: "admin will delete this" });
      const deleted = await deleteUpdate({ organizationId: org.id, boardId: board.id, updateId: created.id, callerId: admin.id, callerIsAdmin: true });
      expect(deleted.id).toBe(created.id);
    });

    it("rejects a non-author, non-admin caller with FORBIDDEN", async () => {
      const created = await createUpdate({ organizationId: org.id, boardId: board.id, itemId: item.id, authorId: owner.id, body: "not yours" });
      await expect(
        deleteUpdate({ organizationId: org.id, boardId: board.id, updateId: created.id, callerId: member.id, callerIsAdmin: false }),
      ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN");
    });

    it("writes ActivityLog and OutboxEvent rows on delete", async () => {
      const created = await createUpdate({ organizationId: org.id, boardId: board.id, itemId: item.id, authorId: owner.id, body: "to be logged deleted" });
      await deleteUpdate({ organizationId: org.id, boardId: board.id, updateId: created.id, callerId: owner.id, callerIsAdmin: false });

      const log = await prisma.activityLog.findFirst({ where: { organizationId: org.id, type: "item.update_deleted", payload: { path: ["updateId"], equals: created.id } } });
      expect(log).not.toBeNull();

      const outbox = await prisma.outboxEvent.findFirst({ where: { organizationId: org.id, type: "item.update_deleted", payload: { path: ["updateId"], equals: created.id } } });
      expect(outbox).not.toBeNull();
    });

    it("rejects deleting a nonexistent comment with NOT_FOUND", async () => {
      await expect(
        deleteUpdate({ organizationId: org.id, boardId: board.id, updateId: "does-not-exist", callerId: owner.id, callerIsAdmin: true }),
      ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND");
    });
  });

  it("cross-org list returns an empty result, not a leak", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other Updates Org" } });
    const page = await listUpdates({ organizationId: otherOrg.id, boardId: board.id, itemId: item.id });
    expect(page.entries).toEqual([]);
    await prisma.organization.deleteMany({ where: { id: otherOrg.id } });
  });

  describe("Session 14: @mentions", () => {
    it("stores a mention token naming a real board member in mentionedUserIds", async () => {
      const created = await createUpdate({
        organizationId: org.id,
        boardId: board.id,
        itemId: item.id,
        authorId: owner.id,
        body: `hey @[${member.email}](${member.id}) take a look`,
      });
      expect(created.mentionedUserIds).toEqual([member.id]);
    });

    it("filters out a mention token naming a user who is not a board member", async () => {
      const outsider = await prisma.user.create({ data: { email: "updates-outsider@test.dev" } });
      const created = await createUpdate({
        organizationId: org.id,
        boardId: board.id,
        itemId: item.id,
        authorId: owner.id,
        body: `cc @[Outsider](${outsider.id})`,
      });
      expect(created.mentionedUserIds).toEqual([]);
      await prisma.user.deleteMany({ where: { id: outsider.id } });
    });

    it("captures multiple distinct mentions and dedupes repeats", async () => {
      const created = await createUpdate({
        organizationId: org.id,
        boardId: board.id,
        itemId: item.id,
        authorId: owner.id,
        body: `@[${admin.email}](${admin.id}) and @[${member.email}](${member.id}), also @[${admin.email}](${admin.id}) again`,
      });
      expect(new Set(created.mentionedUserIds)).toEqual(new Set([admin.id, member.id]));
      expect(created.mentionedUserIds.length).toBe(2);
    });

    it("stores an empty mentionedUserIds array for a comment with no mention tokens", async () => {
      const created = await createUpdate({
        organizationId: org.id,
        boardId: board.id,
        itemId: item.id,
        authorId: owner.id,
        body: "no mentions in this one",
      });
      expect(created.mentionedUserIds).toEqual([]);
    });

    it("listUpdates returns mentionedUserIds on each entry", async () => {
      const created = await createUpdate({
        organizationId: org.id,
        boardId: board.id,
        itemId: item.id,
        authorId: owner.id,
        body: `@[${member.email}](${member.id})`,
      });
      const page = await listUpdates({ organizationId: org.id, boardId: board.id, itemId: item.id });
      const entry = page.entries.find((e) => e.id === created.id);
      expect(entry?.mentionedUserIds).toEqual([member.id]);
    });
  });
});
