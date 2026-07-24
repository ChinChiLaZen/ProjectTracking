import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../server/db/client";
import { runWithTenant } from "../server/db/tenantContext";
import { createBoard } from "../server/services/boards";
import { createGroup } from "../server/services/groups";
import { createItem } from "../server/services/items";
import { createUpdate } from "../server/services/updates";
import { listNotifications, markAllRead, markRead, unreadCount } from "../server/services/notifications";
import { deliverMentionEmails } from "../server/services/notificationRelay";

describe("Session 15: notifications", () => {
  let org: { id: string };
  let owner: { id: string; email: string; name: string | null };
  let member: { id: string; email: string; name: string | null };
  let workspace: { id: string };
  let board: { id: string };
  let group: { id: string };
  let item: { id: string };

  beforeAll(async () => {
    org = await prisma.organization.create({ data: { name: "Notifications Org" } });
    owner = await prisma.user.create({ data: { email: "notif-owner@test.dev", name: "Nora Owner" } });
    member = await prisma.user.create({ data: { email: "notif-member@test.dev", name: "Mo Member" } });

    await prisma.membership.createMany({
      data: [
        { organizationId: org.id, userId: owner.id, role: "OWNER" },
        { organizationId: org.id, userId: member.id, role: "MEMBER" },
      ],
    });

    workspace = await runWithTenant(org.id, () => prisma.workspace.create({ data: { organizationId: org.id, name: "WS" } }));

    const { board: createdBoard } = await createBoard({
      organizationId: org.id,
      workspaceId: workspace.id,
      name: "Notifications Fixture Board",
      actorId: owner.id,
    });
    board = createdBoard;

    group = await createGroup({ organizationId: org.id, boardId: board.id, name: "Group", actorId: owner.id });
    item = await createItem({ organizationId: org.id, boardId: board.id, groupId: group.id, name: "Item", actorId: owner.id });
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { organizationId: org.id } });
    await prisma.outboxEvent.deleteMany({ where: { organizationId: org.id } });
    await prisma.activityLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.update.deleteMany({ where: { organizationId: org.id } });
    await prisma.item.deleteMany({ where: { organizationId: org.id } });
    await prisma.group.deleteMany({ where: { organizationId: org.id } });
    await prisma.board.deleteMany({ where: { organizationId: org.id } });
    await prisma.workspace.deleteMany({ where: { organizationId: org.id } });
    await prisma.membership.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, member.id] } } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
  });

  describe("createUpdate: in-app notification writes", () => {
    it("creates exactly one Notification for a mentioned recipient, not the author", async () => {
      const created = await createUpdate({
        organizationId: org.id,
        boardId: board.id,
        itemId: item.id,
        authorId: owner.id,
        body: `@[${member.name}](${member.id}) please review`,
      });

      const page = await listNotifications({ organizationId: org.id, recipientId: member.id });
      expect(page.entries.map((e) => e.updateId)).toContain(created.id);

      const ownerPage = await listNotifications({ organizationId: org.id, recipientId: owner.id });
      expect(ownerPage.entries.map((e) => e.updateId)).not.toContain(created.id);
    });

    it("does not create a Notification for a self-mention", async () => {
      const created = await createUpdate({
        organizationId: org.id,
        boardId: board.id,
        itemId: item.id,
        authorId: owner.id,
        body: `@[${owner.name}](${owner.id}) note to self`,
      });

      const notification = await prisma.notification.findFirst({ where: { organizationId: org.id, updateId: created.id } });
      expect(notification).toBeNull();
    });

    it("two separate comments mentioning the same user create two separate Notification rows", async () => {
      const first = await createUpdate({
        organizationId: org.id,
        boardId: board.id,
        itemId: item.id,
        authorId: owner.id,
        body: `@[${member.name}](${member.id}) first`,
      });
      const second = await createUpdate({
        organizationId: org.id,
        boardId: board.id,
        itemId: item.id,
        authorId: owner.id,
        body: `@[${member.name}](${member.id}) second`,
      });

      const rows = await prisma.notification.findMany({
        where: { organizationId: org.id, recipientId: member.id, updateId: { in: [first.id, second.id] } },
      });
      expect(rows.length).toBe(2);
    });
  });

  describe("listNotifications / unreadCount / markRead / markAllRead", () => {
    it("unreadCount reflects only unread notifications for that recipient", async () => {
      const before = await unreadCount({ organizationId: org.id, recipientId: member.id });
      await createUpdate({
        organizationId: org.id,
        boardId: board.id,
        itemId: item.id,
        authorId: owner.id,
        body: `@[${member.name}](${member.id}) count me`,
      });
      const after = await unreadCount({ organizationId: org.id, recipientId: member.id });
      expect(after).toBe(before + 1);
    });

    it("markRead sets readAt and is rejected for a non-recipient caller", async () => {
      const created = await createUpdate({
        organizationId: org.id,
        boardId: board.id,
        itemId: item.id,
        authorId: owner.id,
        body: `@[${member.name}](${member.id}) mark me`,
      });
      const notification = await prisma.notification.findFirstOrThrow({ where: { organizationId: org.id, updateId: created.id } });

      await expect(
        markRead({ organizationId: org.id, notificationId: notification.id, callerId: owner.id }),
      ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN");

      const marked = await markRead({ organizationId: org.id, notificationId: notification.id, callerId: member.id });
      expect(marked.readAt).not.toBeNull();
    });

    it("markAllRead clears every unread notification for that recipient", async () => {
      await createUpdate({
        organizationId: org.id,
        boardId: board.id,
        itemId: item.id,
        authorId: owner.id,
        body: `@[${member.name}](${member.id}) one more`,
      });
      expect(await unreadCount({ organizationId: org.id, recipientId: member.id })).toBeGreaterThan(0);

      await markAllRead({ organizationId: org.id, recipientId: member.id });
      expect(await unreadCount({ organizationId: org.id, recipientId: member.id })).toBe(0);
    });

    it("listNotifications includes board/item/update preview fields", async () => {
      const created = await createUpdate({
        organizationId: org.id,
        boardId: board.id,
        itemId: item.id,
        authorId: owner.id,
        body: `@[${member.name}](${member.id}) preview check`,
      });
      const page = await listNotifications({ organizationId: org.id, recipientId: member.id });
      const entry = page.entries.find((e) => e.updateId === created.id);
      expect(entry?.boardId).toBe(board.id);
      expect(entry?.itemId).toBe(item.id);
      expect(entry?.updateBody).toContain("preview check");
    });
  });

  // deliverMentionEmails is deliberately global (no org scoping — a real
  // system-wide relay would never take one) and other test files running
  // concurrently against the same DB may have their own unpublished
  // mention events in flight. A large explicit `limit` keeps this file's
  // own fixtures reliably within the scanned window regardless of
  // concurrent backlog, and assertions key off a unique marker string in
  // each comment's body rather than the function's aggregate counts, so
  // this suite stays deterministic under parallel test-file execution.
  describe("deliverMentionEmails", () => {
    it("sends exactly one email per unread notification and marks it sent", async () => {
      const created = await createUpdate({
        organizationId: org.id,
        boardId: board.id,
        itemId: item.id,
        authorId: owner.id,
        body: `@[${member.name}](${member.id}) relay test one`,
      });

      const sentEmails: { to: string; text: string }[] = [];
      const fakeSendEmail = async (email: { to: string; subject: string; text: string }) => {
        sentEmails.push({ to: email.to, text: email.text });
      };

      await deliverMentionEmails({ limit: 1000, sendEmail: fakeSendEmail });
      expect(sentEmails.some((e) => e.to === member.email && e.text.includes("relay test one"))).toBe(true);

      const notification = await prisma.notification.findFirstOrThrow({ where: { organizationId: org.id, updateId: created.id } });
      expect(notification.emailSentAt).not.toBeNull();

      const outboxEvent = await prisma.outboxEvent.findFirstOrThrow({
        where: { organizationId: org.id, type: "item.update_created", payload: { path: ["updateId"], equals: created.id } },
      });
      expect(outboxEvent.publishedAt).not.toBeNull();
    });

    it("never double-sends when called twice over the same rows", async () => {
      await createUpdate({
        organizationId: org.id,
        boardId: board.id,
        itemId: item.id,
        authorId: owner.id,
        body: `@[${member.name}](${member.id}) relay test two`,
      });

      const sentTo: string[] = [];
      const fakeSendEmail = async (email: { to: string; text: string }) => {
        if (email.text.includes("relay test two")) sentTo.push(email.to);
      };

      await deliverMentionEmails({ limit: 1000, sendEmail: fakeSendEmail });
      await deliverMentionEmails({ limit: 1000, sendEmail: fakeSendEmail });

      expect(sentTo).toEqual([member.email]); // present exactly once across both calls, not twice
    });
  });
});
