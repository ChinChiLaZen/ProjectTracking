import type { ShadowField } from "../columnTypes/types";

// Matches the empty-bucket key convention every column type's groupKeys()
// already uses independently (status.ts, person.ts, text.ts, ...) — not
// re-exported from there since it's a convention, not a contract field on
// GroupKey itself.
const EMPTY_BUCKET_KEY = "__empty__";

// §6: "Kanban groups by any status/dropdown/person column." Every column
// type technically implements groupKeys() (so grouping by e.g. `number` is
// possible), but only a single-valued (`valueText`) or multi-valued
// (`valueRefIds`) shadow field has an unambiguous *inverse* — going from
// "which bucket was this card dropped into" back to "what value should this
// column now have." Branching on shadowField rather than a hardcoded column
// key list (Session 9's original shape) is what let `dropdown` (Session 11)
// become Kanban-groupable with zero new code here — it's a second
// valueText-shadowed type, so it falls straight into the same branch
// `status` already uses. The UI only ever offers valueText/valueRefIds
// columns as "group by" choices.
export function isKanbanGroupable(shadowField: ShadowField): boolean {
  return shadowField === "valueText" || shadowField === "valueRefIds";
}

// Computes the new column value when a card is dropped into
// `targetBucketKey`, given its current value and the bucket it was dragged
// FROM. Multi-valued (valueRefIds) types need both ends: dragging from
// Alice's column to Bob's means "unassign Alice, assign Bob" (Decision 3's
// multi-bucket framing), not "wipe every assignee and set just Bob," which
// a target-only mapping would do. Single-valued (valueText) types ignore
// the source — the target fully determines the new value.
export function valueForGroupKey(
  shadowField: ShadowField,
  currentValue: unknown,
  sourceBucketKey: string,
  targetBucketKey: string,
): unknown {
  if (targetBucketKey === sourceBucketKey) return currentValue;

  if (shadowField === "valueText") {
    return targetBucketKey === EMPTY_BUCKET_KEY ? null : targetBucketKey;
  }

  if (shadowField === "valueRefIds") {
    const current = Array.isArray(currentValue) ? (currentValue as string[]) : [];
    const withoutSource = current.filter((id) => id !== sourceBucketKey);
    if (targetBucketKey === EMPTY_BUCKET_KEY) return withoutSource;
    return [...new Set([...withoutSource, targetBucketKey])];
  }

  // Defensive: the UI never offers a non-groupable shadow field as a
  // "group by" choice, so this only fires on a programmer error or
  // stale/tampered client state — a clear throw beats silently writing a
  // wrong value.
  throw new Error(`Shadow field "${shadowField}" is not Kanban-groupable`);
}
