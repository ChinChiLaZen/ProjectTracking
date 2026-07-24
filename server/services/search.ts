import { prisma } from "../db/client";
import { runWithTenant } from "../db/tenantContext";
import { requireBoardAccess } from "../../lib/permissions/requireBoardAccess";

export type SearchResult = {
  itemId: string;
  boardId: string;
  boardName: string;
  itemName: string;
  itemNumber: number;
  rank: number;
};

type SearchRow = SearchResult;

// §6.1: "Global search... Postgres full-text (tsvector on valueText + item
// name)... must still run requireBoardAccess per matched board so results
// never leak items from boards the user can't open." First $queryRaw in
// the codebase — Postgres full-text search has no first-class Prisma
// schema representation (no generated/stored tsvector column, no
// functional GIN index), so this computes to_tsvector(...) inline at
// query time. That's a sequential scan, not an indexed lookup — a known,
// flagged perf limitation (not silently assumed fast), matching the
// project's "measure before optimizing" pattern (Session 4 measured the
// 10k-item board before optimizing anything). The tenant-scoping Prisma
// Client Extension (server/db/client.ts) does NOT intercept $queryRaw —
// it only hooks the standard CRUD methods — so the explicit
// organizationId predicate below is the real (and only) tenant boundary
// here, not the extension.
export async function searchWorkspace(params: {
  organizationId: string;
  workspaceId: string;
  callerId: string;
  query: string;
  limit?: number;
}): Promise<SearchResult[]> {
  const { organizationId, workspaceId, callerId } = params;
  const query = params.query.trim();
  const limit = params.limit ?? 50;

  if (query === "") return [];

  return runWithTenant(organizationId, async () => {
    // UNION ALL, not UNION — app code below dedupes by max rank per
    // itemId anyway (an item matching both name and a column value would
    // otherwise appear twice with different rank values, which UNION's
    // byte-for-byte row dedup wouldn't catch), so there's no reason to pay
    // for Postgres's own DISTINCT pass on top of that.
    const rows = await prisma.$queryRaw<SearchRow[]>`
      SELECT * FROM (
        SELECT i.id AS "itemId", i."boardId" AS "boardId", b.name AS "boardName",
               i.name AS "itemName", i.number AS "itemNumber",
               ts_rank(to_tsvector('english', i.name), plainto_tsquery('english', ${query})) AS rank
        FROM items i
        JOIN boards b ON b.id = i."boardId"
        WHERE i."organizationId" = ${organizationId}
          AND b."workspaceId" = ${workspaceId}
          AND i."deletedAt" IS NULL
          AND b."deletedAt" IS NULL
          AND to_tsvector('english', i.name) @@ plainto_tsquery('english', ${query})
        UNION ALL
        SELECT i.id AS "itemId", i."boardId" AS "boardId", b.name AS "boardName",
               i.name AS "itemName", i.number AS "itemNumber",
               ts_rank(to_tsvector('english', cv."valueText"), plainto_tsquery('english', ${query})) AS rank
        FROM column_values cv
        JOIN items i ON i.id = cv."itemId"
        JOIN boards b ON b.id = i."boardId"
        WHERE cv."organizationId" = ${organizationId}
          AND b."workspaceId" = ${workspaceId}
          AND i."deletedAt" IS NULL
          AND b."deletedAt" IS NULL
          AND cv."valueText" IS NOT NULL
          AND to_tsvector('english', cv."valueText") @@ plainto_tsquery('english', ${query})
      ) matches
      ORDER BY rank DESC
      LIMIT ${limit * 3}
    `;

    const byItemId = new Map<string, SearchRow>();
    for (const row of rows) {
      const existing = byItemId.get(row.itemId);
      if (!existing || row.rank > existing.rank) {
        byItemId.set(row.itemId, row);
      }
    }
    const deduped = [...byItemId.values()].sort((a, b) => b.rank - a.rank);

    // Checked once per DISTINCT matched board, not once per row — a board
    // failing this check drops all of its rows silently (never surfaced
    // as an error), the anti-leak behavior §6.1 requires.
    const distinctBoardIds = [...new Set(deduped.map((r) => r.boardId))];
    const accessibleBoardIds = new Set<string>();
    for (const boardId of distinctBoardIds) {
      try {
        await requireBoardAccess({ userId: callerId, organizationId }, boardId, "GUEST");
        accessibleBoardIds.add(boardId);
      } catch {
        // Caller can't access this board — excluded, not an error.
      }
    }

    return deduped.filter((r) => accessibleBoardIds.has(r.boardId)).slice(0, limit);
  });
}
