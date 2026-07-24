import { getColumnType } from "../columnTypes/types";
import { getOperator } from "../columnTypes/operators";
import type { ColumnTypeRegistry, FilterOperatorDef, ShadowField } from "../columnTypes/types";
import { viewConfigSchema, type FilterClause, type SortClause, type ViewConfig } from "./viewConfig";

// A filter row as the builder UI edits it — args stay raw strings so a
// half-typed number/date isn't silently dropped mid-keystroke. Converted to
// typed FilterClause args only once a row is "complete" (see below).
export type RawFilterRow = {
  id: string;
  columnId: string;
  operatorKey: string;
  args: string[];
};

export type RawSort = SortClause | null;

type BuilderColumn = { id: string; key: string };

// arity 0 (is_empty) is always complete; arity 1/2 need every arg to be a
// non-empty, parseable value. A row failing this check is dropped from the
// derived (queried) config while the UI still renders it mid-edit.
export function isFilterComplete(operator: FilterOperatorDef, shadowField: ShadowField, args: string[]): boolean {
  if (operator.arity === 0) return true;
  if (args.length < operator.arity) return false;
  const relevant = args.slice(0, operator.arity);
  if (relevant.some((a) => a.trim().length === 0)) return false;
  if (shadowField === "valueNumber") {
    return relevant.every((a) => Number.isFinite(Number(a)));
  }
  return true;
}

function toTypedArgs(shadowField: ShadowField, args: string[]): unknown[] {
  if (shadowField === "valueNumber") {
    return args.map((a) => Number(a));
  }
  // valueText/valueDate/valueRefIds all travel as strings — dates are
  // ISO date strings (same convention the `date` column type's Editor
  // already uses), and Prisma/tRPC's JSON transport strips a real Date
  // down to a string anyway before compileQuery.ts ever sees it.
  return args;
}

// Turns the builder's raw editing state into the ViewConfig that's actually
// queried. Unknown columnIds (a row referencing a since-deleted column) and
// incomplete rows are silently dropped rather than thrown — a stale/mid-edit
// row shouldn't crash the live query.
export function deriveViewConfig(
  rawFilters: RawFilterRow[],
  sort: RawSort,
  columns: BuilderColumn[],
  registry: ColumnTypeRegistry,
): ViewConfig {
  const columnById = new Map(columns.map((c) => [c.id, c]));

  const filters: FilterClause[] = [];
  for (const row of rawFilters) {
    const column = columnById.get(row.columnId);
    if (!column) continue;
    const columnType = getColumnType(registry, column.key);
    let operator: FilterOperatorDef;
    try {
      operator = getOperator(columnType.shadowField, row.operatorKey, columnType.extraOperators);
    } catch {
      continue;
    }
    if (!isFilterComplete(operator, columnType.shadowField, row.args)) continue;
    filters.push({
      columnId: row.columnId,
      operatorKey: row.operatorKey,
      args: toTypedArgs(columnType.shadowField, row.args.slice(0, operator.arity)),
    });
  }

  const resolvedSort = sort?.columnId && columnById.has(sort.columnId) ? sort : null;

  return viewConfigSchema.parse({ filters, sort: resolvedSort });
}
