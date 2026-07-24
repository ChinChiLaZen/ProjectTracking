import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../server/db/client";
import { runWithTenant } from "../server/db/tenantContext";
import { createBoard } from "../server/services/boards";
import { createGroup } from "../server/services/groups";
import { createItem } from "../server/services/items";
import { createAttachment, deleteAttachment, getAttachment, listAttachments } from "../server/services/attachments";

// A real, valid 1x1 PNG — the same fixture used in lib/storage/validateUpload
// isn't reused directly (createAttachment doesn't call validateUpload
// itself — that's the upload Route Handler's job, exercised manually in
// the browser per the plan) but this keeps fixtures realistic regardless.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("Session 16: attachments", () => {
  let org: { id: string };
  let owner: { id: string };
  let admin: { id: string };
  let member: { id: string };
  let workspace: { id: string };
  let board: { id: string };
  let group: { id: string };
  let item: { id: string };

  beforeAll(async () => {
    org = await prisma.organization.create({ data: { name: "Attachments Org" } });
    owner = await prisma.user.create({ data: { email: "attach-owner@test.dev" } });
    admin = await prisma.user.create({ data: { email: "attach-admin@test.dev" } });
    member = await prisma.user.create({ data: { email: "attach-member@test.dev" } });

    await prisma.membership.createMany({
      data: [
        { organizationId: org.id, userId: owner.id, role: "OWNER" },
        { organizationId: org.id, userId: admin.id, role: "ADMIN" },
        { organizationId: org.id, userId: member.id, role: "MEMBER" },
      ],
    });

    workspace = await runWithTenant(org.id, () => prisma.workspace.create({ data: { organizationId: org.id, name: "WS" } }));

    const { board: createdBoard } = await createBoard({
      organizationId: org.id,
      workspaceId: workspace.id,
      name: "Attachments Fixture Board",
      actorId: owner.id,
    });
    board = createdBoard;

    group = await createGroup({ organizationId: org.id, boardId: board.id, name: "Group", actorId: owner.id });
    item = await createItem({ organizationId: org.id, boardId: board.id, groupId: group.id, name: "Item", actorId: owner.id });
  });

  afterAll(async () => {
    await prisma.outboxEvent.deleteMany({ where: { organizationId: org.id } });
    await prisma.activityLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.attachment.deleteMany({ where: { organizationId: org.id } });
    await prisma.item.deleteMany({ where: { organizationId: org.id } });
    await prisma.group.deleteMany({ where: { organizationId: org.id } });
    await prisma.board.deleteMany({ where: { organizationId: org.id } });
    await prisma.workspace.deleteMany({ where: { organizationId: org.id } });
    await prisma.membership.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, admin.id, member.id] } } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
  });

  it("creates an attachment and lists it back, round-tripping the uploaded bytes", async () => {
    const created = await createAttachment({
      organizationId: org.id,
      boardId: board.id,
      itemId: item.id,
      uploaderId: owner.id,
      fileName: "demo.png",
      mimeType: "image/png",
      body: PNG_BYTES,
    });
    expect(created.fileName).toBe("demo.png");
    expect(created.fileSize).toBe(PNG_BYTES.byteLength);

    const page = await listAttachments({ organizationId: org.id, boardId: board.id, itemId: item.id });
    expect(page.entries.map((e) => e.id)).toContain(created.id);
  });

  it("lists attachments newest-first", async () => {
    const freshItem = await createItem({ organizationId: org.id, boardId: board.id, groupId: group.id, name: "Chrono Item", actorId: owner.id });
    const first = await createAttachment({
      organizationId: org.id,
      boardId: board.id,
      itemId: freshItem.id,
      uploaderId: owner.id,
      fileName: "one.png",
      mimeType: "image/png",
      body: PNG_BYTES,
    });
    const second = await createAttachment({
      organizationId: org.id,
      boardId: board.id,
      itemId: freshItem.id,
      uploaderId: owner.id,
      fileName: "two.png",
      mimeType: "image/png",
      body: PNG_BYTES,
    });

    const page = await listAttachments({ organizationId: org.id, boardId: board.id, itemId: freshItem.id });
    expect(page.entries.map((e) => e.id)).toEqual([second.id, first.id]);
  });

  it("rejects creating an attachment on an item that doesn't belong to the given board", async () => {
    const otherBoard = await runWithTenant(org.id, () =>
      prisma.board.create({ data: { organizationId: org.id, workspaceId: workspace.id, name: "Other Board" } }),
    );
    await expect(
      createAttachment({
        organizationId: org.id,
        boardId: otherBoard.id,
        itemId: item.id,
        uploaderId: owner.id,
        fileName: "x.png",
        mimeType: "image/png",
        body: PNG_BYTES,
      }),
    ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND");
    await prisma.board.deleteMany({ where: { id: otherBoard.id } });
  });

  it("writes ActivityLog and OutboxEvent rows on create", async () => {
    const created = await createAttachment({
      organizationId: org.id,
      boardId: board.id,
      itemId: item.id,
      uploaderId: owner.id,
      fileName: "logged.png",
      mimeType: "image/png",
      body: PNG_BYTES,
    });

    const log = await prisma.activityLog.findFirst({
      where: { organizationId: org.id, type: "item.attachment_created", payload: { path: ["attachmentId"], equals: created.id } },
    });
    expect(log).not.toBeNull();

    const outbox = await prisma.outboxEvent.findFirst({
      where: { organizationId: org.id, type: "item.attachment_created", payload: { path: ["attachmentId"], equals: created.id } },
    });
    expect(outbox).not.toBeNull();
  });

  describe("deleteAttachment", () => {
    it("allows the uploader to delete their own attachment", async () => {
      const created = await createAttachment({
        organizationId: org.id,
        boardId: board.id,
        itemId: item.id,
        uploaderId: member.id,
        fileName: "delete-me.png",
        mimeType: "image/png",
        body: PNG_BYTES,
      });
      const deleted = await deleteAttachment({ organizationId: org.id, boardId: board.id, attachmentId: created.id, callerId: member.id, callerIsAdmin: false });
      expect(deleted.id).toBe(created.id);

      const page = await listAttachments({ organizationId: org.id, boardId: board.id, itemId: item.id });
      expect(page.entries.map((e) => e.id)).not.toContain(created.id);
    });

    it("allows an ADMIN to delete someone else's attachment", async () => {
      const created = await createAttachment({
        organizationId: org.id,
        boardId: board.id,
        itemId: item.id,
        uploaderId: member.id,
        fileName: "admin-will-delete.png",
        mimeType: "image/png",
        body: PNG_BYTES,
      });
      const deleted = await deleteAttachment({ organizationId: org.id, boardId: board.id, attachmentId: created.id, callerId: admin.id, callerIsAdmin: true });
      expect(deleted.id).toBe(created.id);
    });

    it("rejects a non-uploader, non-admin caller with FORBIDDEN", async () => {
      const created = await createAttachment({
        organizationId: org.id,
        boardId: board.id,
        itemId: item.id,
        uploaderId: owner.id,
        fileName: "not-yours.png",
        mimeType: "image/png",
        body: PNG_BYTES,
      });
      await expect(
        deleteAttachment({ organizationId: org.id, boardId: board.id, attachmentId: created.id, callerId: member.id, callerIsAdmin: false }),
      ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN");
    });

    it("writes ActivityLog and OutboxEvent rows on delete", async () => {
      const created = await createAttachment({
        organizationId: org.id,
        boardId: board.id,
        itemId: item.id,
        uploaderId: owner.id,
        fileName: "to-be-logged-deleted.png",
        mimeType: "image/png",
        body: PNG_BYTES,
      });
      await deleteAttachment({ organizationId: org.id, boardId: board.id, attachmentId: created.id, callerId: owner.id, callerIsAdmin: false });

      const log = await prisma.activityLog.findFirst({
        where: { organizationId: org.id, type: "item.attachment_deleted", payload: { path: ["attachmentId"], equals: created.id } },
      });
      expect(log).not.toBeNull();

      const outbox = await prisma.outboxEvent.findFirst({
        where: { organizationId: org.id, type: "item.attachment_deleted", payload: { path: ["attachmentId"], equals: created.id } },
      });
      expect(outbox).not.toBeNull();
    });

    it("rejects deleting a nonexistent attachment with NOT_FOUND", async () => {
      await expect(
        deleteAttachment({ organizationId: org.id, boardId: board.id, attachmentId: "does-not-exist", callerId: owner.id, callerIsAdmin: true }),
      ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND");
    });
  });

  it("getAttachment is tenant-scoped — cross-org lookup returns null, not a leak", async () => {
    const created = await createAttachment({
      organizationId: org.id,
      boardId: board.id,
      itemId: item.id,
      uploaderId: owner.id,
      fileName: "scoped.png",
      mimeType: "image/png",
      body: PNG_BYTES,
    });

    const otherOrg = await prisma.organization.create({ data: { name: "Other Attachments Org" } });
    const found = await getAttachment({ organizationId: otherOrg.id, attachmentId: created.id });
    expect(found).toBeNull();
    await prisma.organization.deleteMany({ where: { id: otherOrg.id } });
  });

  it("cross-org list returns an empty result, not a leak", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other Attachments Org 2" } });
    const page = await listAttachments({ organizationId: otherOrg.id, boardId: board.id, itemId: item.id });
    expect(page.entries).toEqual([]);
    await prisma.organization.deleteMany({ where: { id: otherOrg.id } });
  });
});
