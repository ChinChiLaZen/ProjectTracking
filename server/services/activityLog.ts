import { prisma } from "../db/client";
import { runWithTenant } from "../db/tenantContext";

export type ActivityEntry = {
  id: string;
  itemId: string | null;
  actorType: string;
  actorId: string;
  type: string;
  // Erased to `unknown` on purpose, same reasoning as BoardColumnValue in
  // items.ts — Prisma's recursive JsonValue type blows up TS through
  // useInfiniteQuery's generics.
  payload: unknown;
  createdAt: Date;
};

// First reader of ActivityLog — every mutation since Session 2 has already
// been writing these rows; this is the first query path for them (§6's
// "activity feed").
export async function listActivity(params: { organizationId: string; boardId: string; cursor?: string; limit?: number }) {
  const { organizationId, boardId, cursor } = params;
  const limit = params.limit ?? 50;

  return runWithTenant(organizationId, async () => {
    const rows = await prisma.activityLog.findMany({
      where: { boardId, organizationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const entries: ActivityEntry[] = page.map((r) => ({
      id: r.id,
      itemId: r.itemId,
      actorType: r.actorType,
      actorId: r.actorId,
      type: r.type,
      payload: r.payload,
      createdAt: r.createdAt,
    }));

    return { entries, nextCursor: hasMore ? page[page.length - 1]!.id : null };
  });
}
