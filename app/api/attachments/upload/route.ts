import { NextResponse } from "next/server";
import { TRPCError } from "@trpc/server";
import { authorizeBoardRequest } from "@/server/http/routeAuth";
import { validateUpload } from "@/lib/storage/validateUpload";
import { createAttachment } from "@/server/services/attachments";

// The first multipart-body route in this codebase — tRPC's JSON-RPC
// transport can't carry a file, so this exists outside tRPC entirely (see
// server/http/routeAuth.ts for how it still gets the same auth guarantees
// every tRPC procedure has). Uses the Web-standard `request.formData()`/
// `File` API — no multer/formidable/busboy dependency needed.
export async function POST(request: Request) {
  const formData = await request.formData();
  const boardId = formData.get("boardId");
  const itemId = formData.get("itemId");
  const file = formData.get("file");

  if (typeof boardId !== "string" || typeof itemId !== "string" || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing boardId, itemId, or file" }, { status: 400 });
  }

  const auth = await authorizeBoardRequest(boardId, "GUEST"); // item.edit (§5) — "create/edit/move items, comment"
  if (!auth.ok) return auth.response;

  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = await validateUpload(buffer, file.name);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }

  try {
    const attachment = await createAttachment({
      organizationId: auth.ctx.organizationId,
      boardId,
      itemId,
      uploaderId: auth.ctx.userId,
      fileName: file.name,
      mimeType: validation.mimeType,
      body: buffer,
    });
    return NextResponse.json(attachment, { status: 201 });
  } catch (err) {
    if (err instanceof TRPCError && err.code === "NOT_FOUND") {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    throw err;
  }
}
