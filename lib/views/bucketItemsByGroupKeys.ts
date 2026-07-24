import type { ColumnType, GroupKey } from "../columnTypes/types";

export type KanbanBucket = { key: string; label: string; color?: string; itemIds: string[] };

type StatusOption = { id: string; label: string; color?: string; order: number };

const EMPTY_BUCKET_KEY = "__empty__";

// Buckets a group's already-fetched, already-filtered/sorted items by a
// column's groupKeys() (§4.3 Decision 3) — a presentation-layer grouping
// over data item.list already correctly paginated, not a second DB query
// (§6: "views differ in presentation and grouping only").
//
// `status`/`dropdown` are special-cased to enumerate every configured
// option (even ones with zero items right now) in its configured order,
// plus one explicit "No value" bucket — otherwise an empty option never
// renders as a droppable Kanban bucket and becomes unreachable by drag
// (closes the gap Session 5 flagged when no Kanban view existed to make it
// matter). Kept as an explicit key check, not generalized to shadowField
// the way isKanbanGroupable/valueForGroupKey were (Session 11) — the
// underlying trait, "has an exhaustive settings.options list," isn't part
// of the registry's type contract the way shadowField is. Every other
// groupable type (`person`) only buckets *observed* values, in first-seen
// order — there's no board-membership list yet to enumerate "every
// possible person" (same gap Session 5 flagged for the people-picker), so
// this is a known, carried-forward limitation, not a new one.
export function bucketItemsByGroupKeys<T extends { id: string }>(
  items: T[],
  valueFor: (itemId: string) => unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous registry lookup, matches ColumnTypeRegistry's own any
  columnType: ColumnType<any, any>,
  settings: unknown,
): KanbanBucket[] {
  const byKey = new Map<string, KanbanBucket>();

  if (columnType.key === "status" || columnType.key === "dropdown") {
    const options = (settings as { options?: StatusOption[] } | undefined)?.options ?? [];
    for (const option of [...options].sort((a, b) => a.order - b.order)) {
      byKey.set(option.id, { key: option.id, label: option.label, color: option.color, itemIds: [] });
    }
    byKey.set(EMPTY_BUCKET_KEY, { key: EMPTY_BUCKET_KEY, label: "No value", itemIds: [] });
  }

  for (const item of items) {
    const value = valueFor(item.id) ?? columnType.defaultValue(settings);
    const keys: GroupKey[] = columnType.groupKeys(value, settings);
    for (const gk of keys) {
      if (!byKey.has(gk.key)) {
        byKey.set(gk.key, { key: gk.key, label: gk.label, color: gk.color, itemIds: [] });
      }
      byKey.get(gk.key)!.itemIds.push(item.id);
    }
  }

  return [...byKey.values()];
}
