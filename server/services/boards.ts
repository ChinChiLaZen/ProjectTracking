import { prisma } from "../db/client";
import { runWithTenant } from "../db/tenantContext";

export type BoardColumnDefinition = {
  id: string;
  key: string;
  name: string;
  settings: unknown; // erased on purpose — see items.ts's BoardColumnValue for why
  rank: string;
};

// Session 4: split off from the old getBoardData, which loaded every item +
// value unconditionally — the opposite of the §8 budget at 10k items. This
// is now just the board "shell": metadata, groups, and column definitions.
// Items/values are paginated per group via item.list (server/services/items.ts).
export async function getBoardShell(organizationId: string, boardId: string) {
  return runWithTenant(organizationId, async () => {
    const [board, groups, rawColumns] = await Promise.all([
      prisma.board.findFirstOrThrow({ where: { id: boardId, organizationId } }),
      prisma.group.findMany({ where: { boardId, organizationId }, orderBy: { rank: "asc" } }),
      prisma.columnDefinition.findMany({ where: { boardId, organizationId }, orderBy: { rank: "asc" } }),
    ]);

    const columns: BoardColumnDefinition[] = rawColumns.map((c) => ({
      id: c.id,
      key: c.key,
      name: c.name,
      settings: c.settings,
      rank: c.rank,
    }));

    return {
      board: { id: board.id, name: board.name, timeZone: board.timeZone },
      groups,
      columns,
    };
  });
}
