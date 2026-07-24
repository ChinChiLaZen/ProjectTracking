import { NextResponse } from "next/server";
import { getAttachment } from "@/server/services/attachments";
import { getStorageAdapter } from "@/lib/storage";
import { resolveSessionContext } from "@/server/trpc/context";
import { authorizeBoardRequest } from "@/server/http/routeAuth";

// Loads the Attachment row first (tenant-scoped via the session's own
// organizationId — missing/wrong-org is indistinguishable from not
// existing, same anti-probing shape requireBoardAccess already uses) to
// learn its boardId, *then* authorizes against that board — the row itself
// is the only source of which board's permission applies, no boardId query
// param needed.
export async function GET(_request: Request, { params }: { params: Promise<{ attachmentId: string }> }) {
  const { attachmentId } = await params;
  const { organizationId } = await resolveSessionContext();
  if (!organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const attachment = await getAttachment({ organizationId, attachmentId });
  if (!attachment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const auth = await authorizeBoardRequest(attachment.boardId, "GUEST"); // board.read (§5)
  if (!auth.ok) return auth.response;

  const body = await getStorageAdapter().download(attachment.storageKey);
  if (!body) {
    return NextResponse.json({ error: "File missing from storage" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(attachment.fileName)}"`,
      "Content-Length": String(attachment.fileSize),
    },
  });
}
