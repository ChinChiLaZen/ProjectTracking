import { prisma } from "../db/client";
import { runWithTenant } from "../db/tenantContext";

// Both erase Prisma's recursive JsonValue field to `unknown` on purpose:
// carried through tRPC + react-query's generics, it blows up TS ("type
// instantiation is excessively deep") — and the client only ever passes
// these straight to the owning column type's Cell/Editor anyway.
export type BoardColumnValue = {
  itemId: string;
  columnId: string;
  value: unknown;
  version: number;
};

export type BoardColumnDefinition = {
  id: string;
  key: string;
  name: string;
  settings: unknown;
  rank: string;
};

// The single useBoardData query path (§6) — every view reads from this,
// differing only in presentation/grouping, never in a second query path.
// Unpaginated for now; cursor pagination + virtualization is Session 4.
export async function getBoardData(organizationId: string, boardId: string) {
  return runWithTenant(organizationId, async () => {
    const [groups, items, rawColumns, rawValues] = await Promise.all([
      prisma.group.findMany({ where: { boardId, organizationId }, orderBy: { rank: "asc" } }),
      prisma.item.findMany({ where: { boardId, organizationId }, orderBy: { rank: "asc" } }),
      prisma.columnDefinition.findMany({ where: { boardId, organizationId }, orderBy: { rank: "asc" } }),
      prisma.columnValue.findMany({ where: { boardId, organizationId } }),
    ]);

    const columns: BoardColumnDefinition[] = rawColumns.map((c) => ({
      id: c.id,
      key: c.key,
      name: c.name,
      settings: c.settings,
      rank: c.rank,
    }));

    // Shadow columns (valueText/valueNumber/...) are a filter/sort
    // implementation detail — the client only ever needs the canonical
    // value + version for rendering and optimistic-concurrency checks.
    const values: BoardColumnValue[] = rawValues.map((v) => ({
      itemId: v.itemId,
      columnId: v.columnId,
      value: v.value,
      version: v.version,
    }));

    return { groups, items, columns, values };
  });
}
