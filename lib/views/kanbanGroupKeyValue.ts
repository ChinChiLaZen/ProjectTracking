// Matches the empty-bucket key convention every column type's groupKeys()
// already uses independently (status.tsx, person.tsx, text.tsx, ...) — not
// re-exported from there since it's a convention, not a contract field on
// GroupKey itself.
const EMPTY_BUCKET_KEY = "__empty__";

// §6: "Kanban groups by any status/dropdown/person column." dropdown
// doesn't exist as a column type yet. Every column type technically
// implements groupKeys() (so grouping by e.g. `number` is possible), but
// only status/person have an unambiguous *inverse* — going from "which
// bucket was this card dropped into" back to "what value should this
// column now have." A generic inverse would need a new §4.3 registry hook
// for a need only this one feature has right now (see Session 9's decision
// log) — not built. The UI only ever offers these two as "group by" choices.
const KANBAN_GROUPABLE_COLUMN_KEYS = new Set(["status", "person"]);

export function isKanbanGroupable(columnKey: string): boolean {
  return KANBAN_GROUPABLE_COLUMN_KEYS.has(columnKey);
}

// Computes the new column value when a card is dropped into
// `targetBucketKey`, given its current value and the bucket it was dragged
// FROM. `person` needs both ends: dragging from Alice's column to Bob's
// means "unassign Alice, assign Bob" (Decision 3's multi-bucket framing),
// not "wipe every assignee and set just Bob," which a target-only mapping
// would do. `status` is single-valued — the source is irrelevant.
export function valueForGroupKey(
  columnKey: string,
  currentValue: unknown,
  sourceBucketKey: string,
  targetBucketKey: string,
): unknown {
  if (targetBucketKey === sourceBucketKey) return currentValue;

  if (columnKey === "status") {
    return targetBucketKey === EMPTY_BUCKET_KEY ? null : targetBucketKey;
  }

  if (columnKey === "person") {
    const current = Array.isArray(currentValue) ? (currentValue as string[]) : [];
    const withoutSource = current.filter((id) => id !== sourceBucketKey);
    if (targetBucketKey === EMPTY_BUCKET_KEY) return withoutSource;
    return [...new Set([...withoutSource, targetBucketKey])];
  }

  // Defensive: the UI never offers a non-groupable column as a "group by"
  // choice, so this only fires on a programmer error or stale/tampered
  // client state — a clear throw beats silently writing a wrong value.
  throw new Error(`Column type "${columnKey}" is not Kanban-groupable`);
}
