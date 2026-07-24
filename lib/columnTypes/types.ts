/**
 * lib/columnTypes/types.ts
 *
 * The registry contract. Every column type implements this and nothing else
 * knows about column types. See CLAUDE.md §4.3 / ground rule 6.
 *
 * This interface was stress-tested against `person` (array value),
 * `date` (two-argument operators, timezone) and `formula` (no stored value)
 * BEFORE implementing anything — the five annotated decisions below are the
 * result. Do not simplify them back out while implementing `text`; they will
 * be needed by the fifth column type and are expensive to add then.
 *
 * Assumes Zod + React. Replace the SQL fragment type with whatever the
 * filter compiler actually emits (Prisma.Sql, Kysely expression, etc.).
 */

import type { ComponentType } from "react";
import type { ZodType } from "zod";
import type { Prisma } from "../../generated/prisma/client";

/* ------------------------------------------------------------------ */
/* Shadow columns                                                      */
/* ------------------------------------------------------------------ */

/** Indexable projections on ColumnValue. Filtering and sorting only ever touch these. */
export type ShadowField =
  | "valueText"
  | "valueNumber"
  | "valueDate"
  | "valueRefIds";

export type Shadow = {
  valueText?: string | null;
  valueNumber?: number | null;
  valueDate?: Date | null;
  valueDateEnd?: Date | null;
  valueRefIds?: string[];
};

/**
 * DECISION 1 — toShadow receives a context, not just (value, settings).
 *
 * `formula` and `rollup` have no stored value: their result is derived from
 * sibling columns on the same item. A (value, settings) signature cannot
 * express that, and discovering it at column type #8 means changing every
 * type's signature. Plain types simply ignore everything except `value`.
 */
export type DeriveContext<TValue, TSettings> = {
  value: TValue;
  settings: TSettings;
  item: { id: string; boardId: string; groupId: string };
  /** other column values on the same item — only computed types read this */
  valuesByColumnId: Readonly<Record<string, unknown>>;
  columnsById: Readonly<
    Record<string, { id: string; type: string; settings: unknown }>
  >;
  /** board timezone, for date-like types */
  timeZone: string;
};

/* ------------------------------------------------------------------ */
/* Filter operators                                                    */
/* ------------------------------------------------------------------ */

/**
 * DECISION 2 — operators belong to the SHADOW FIELD, not to the column type.
 *
 * `text`, `long_text`, `status` and `dropdown` all filter on valueText and all
 * want the same operators. Declaring them per column type guarantees four
 * slightly different implementations of "is empty". Column types declare which
 * shadow field they use and inherit that field's operator set; `extraOperators`
 * is the escape hatch, not the default.
 */
export type FilterOperatorDef = {
  key: string;
  label: string;
  /** 0 = is_empty, 1 = equals, 2 = between — the date case the old shape couldn't express */
  arity: 0 | 1 | 2;
  /** builds the predicate against the shadow column; never runs in JS */
  toSql: (column: ShadowField, args: unknown[]) => SqlFragment;
};

// Session 4: concretized from the original `unknown` placeholder now that
// the filter compiler (lib/views/compileQuery.ts) actually exists — a
// fragment of ColumnValue's own where-input, applied inside a
// `values: { some: { columnId, ...fragment } }` clause per filter.
export type SqlFragment = Prisma.ColumnValueWhereInput;

/** Shared per-shadow-field operator sets live in lib/columnTypes/operators.ts */
export type OperatorSets = Record<ShadowField, FilterOperatorDef[]>;

/* ------------------------------------------------------------------ */
/* Grouping                                                            */
/* ------------------------------------------------------------------ */

/**
 * DECISION 3 — grouping is its own function, and it returns an ARRAY.
 *
 * Kanban / group-by needs a bucket key, which is not the display string
 * (status buckets by optionId, date buckets by day, not by rendered label).
 * It returns 0..n keys because a `person` column with two assignees puts the
 * item in two Kanban columns, and an empty value belongs to an explicit
 * "no value" bucket rather than disappearing. A single-string return would
 * have to be widened later, breaking every implementation.
 */
export type GroupKey = { key: string; label: string; color?: string };

/* ------------------------------------------------------------------ */
/* Settings migration                                                  */
/* ------------------------------------------------------------------ */

/**
 * DECISION 4 — settings changes need a value reconciliation hook.
 *
 * Deleting a status option leaves every ColumnValue pointing at a dead
 * optionId. Someone has to decide: clear them, or remap them. That decision
 * belongs to the column type, and it must run in the same transaction as the
 * settings update. Types without option sets return null.
 */
export type ValueMigration = {
  /** applied to every ColumnValue of this column, inside the settings-update transaction */
  remap: (value: unknown) => unknown;
  /** shown to the user before they confirm: "3 items will be cleared" */
  describe: (affectedCount: number) => string;
};

/* ------------------------------------------------------------------ */
/* The contract                                                        */
/* ------------------------------------------------------------------ */

export type CellProps<TValue, TSettings> = {
  value: TValue;
  settings: TSettings;
  readOnly: boolean;
};

export type EditorProps<TValue, TSettings> = {
  value: TValue;
  settings: TSettings;
  /** caller handles optimistic update + version conflict; the editor just reports intent */
  onChange: (next: TValue) => void;
  onCancel: () => void;
};

export type ColumnType<TValue, TSettings = Record<string, never>> = {
  key: string;

  /**
   * DECISION 5 — computed types are declared, not inferred.
   * `formula` / `rollup` are never user-writable: setColumnValue must reject
   * writes to them, and they must be recomputed when their dependencies change.
   * A boolean here is what lets the service layer enforce both rules generically
   * instead of hardcoding a list of type names.
   */
  computed?: boolean;

  valueSchema: ZodType<TValue>;
  settingsSchema: ZodType<TSettings>;
  defaultValue: (settings: TSettings) => TValue;

  /** which shadow column this type filters and sorts on */
  shadowField: ShadowField;
  toShadow: (ctx: DeriveContext<TValue, TSettings>) => Shadow;

  /**
   * NOTE: there is deliberately no `sortComparator`.
   * Sorting is `ORDER BY <shadowField>` in SQL. A JS comparator in this
   * interface is an invitation to fetch-then-sort, which breaks pagination
   * and the performance budget. If a type cannot be sorted by its shadow
   * field, the shadow projection is wrong — fix that, not this.
   */

  isEmpty: (value: TValue) => boolean;
  groupKeys: (value: TValue, settings: TSettings) => GroupKey[];

  extraOperators?: FilterOperatorDef[];
  reconcileValues?: (prev: TSettings, next: TSettings) => ValueMigration | null;

  /** used by search, CSV export, and notification text — one source of truth */
  toDisplayString: (value: TValue, settings: TSettings) => string;
  /** CSV import and paste-into-grid share this */
  parse: (input: string, settings: TSettings) => TValue | null;

  Cell: ComponentType<CellProps<TValue, TSettings>>;
  Editor: ComponentType<EditorProps<TValue, TSettings>>;
};

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

/**
 * The ONLY place that maps a type string to behaviour.
 * If a `switch (column.type)` appears anywhere else, it belongs here instead.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous registry; `unknown` would force a cast at every lookup site
export type ColumnTypeRegistry = Record<string, ColumnType<any, any>>;

export function getColumnType(
  registry: ColumnTypeRegistry,
  key: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see ColumnTypeRegistry
): ColumnType<any, any> {
  const t = registry[key];
  if (!t) throw new Error(`Unknown column type: ${key}`);
  return t;
}
