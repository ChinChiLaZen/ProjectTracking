"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { columnTypeRegistry } from "@/lib/columnTypes/registry";
import { getColumnType } from "@/lib/columnTypes/types";
import { operatorSets } from "@/lib/columnTypes/operators";
import { deriveViewConfig, type RawFilterRow, type RawSort } from "@/lib/views/deriveDraftConfig";
import type { FilterClause, SortClause, ViewConfig } from "@/lib/views/viewConfig";
import type { ShadowField } from "@/lib/columnTypes/types";

type BuilderColumn = { id: string; key: string; name: string };

const rowStyle: CSSProperties = { display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.25rem" };
const inputStyle: CSSProperties = { width: "8rem" };

function inputTypeFor(shadowField: ShadowField): "number" | "date" | "text" {
  if (shadowField === "valueNumber") return "number";
  if (shadowField === "valueDate") return "date";
  return "text";
}

function operatorsFor(column: BuilderColumn | undefined) {
  if (!column) return [];
  const columnType = getColumnType(columnTypeRegistry, column.key);
  return [...operatorSets[columnType.shadowField], ...(columnType.extraOperators ?? [])];
}

function shadowFieldFor(column: BuilderColumn | undefined): ShadowField {
  if (!column) return "valueText";
  return getColumnType(columnTypeRegistry, column.key).shadowField;
}

// Builds filters/sort for the *draft* viewConfig that's actually queried —
// see lib/views/deriveDraftConfig.ts for the pure derivation this wraps.
// Uncontrolled by design: internal row state is seeded once from
// `initialConfig` and never reconciled back to it on every render (that
// would fight a user mid-keystroke); the caller resets it by remounting via
// `key` (e.g. `key={viewId ?? "default"}`) when the loaded view changes.
export function FilterSortBuilder({
  columns,
  initialConfig,
  onChange,
}: {
  columns: BuilderColumn[];
  initialConfig: ViewConfig;
  // Reports only the filters/sort delta, not a full ViewConfig — the caller
  // (BoardTable) merges this into its own draftConfig. Session 9: this used
  // to report the whole deriveViewConfig(...) result, which silently reset
  // draftConfig.type/groupBy back to their schema defaults on every filter
  // edit, clobbering a Kanban toggle the moment a user touched a filter.
  onChange: (delta: { filters: FilterClause[]; sort: SortClause | null }) => void;
}) {
  // crypto.randomUUID() rather than a ref-based counter — accessing a ref's
  // .current during render (including a useState lazy initializer, which
  // runs at render time on mount) is disallowed by the React Compiler.
  const [rawFilters, setRawFilters] = useState<RawFilterRow[]>(() =>
    initialConfig.filters.map((f) => ({
      id: crypto.randomUUID(),
      columnId: f.columnId,
      operatorKey: f.operatorKey,
      args: f.args.map((a) => String(a)),
    })),
  );
  const [sort, setSort] = useState<RawSort>(initialConfig.sort);

  useEffect(() => {
    const config = deriveViewConfig(rawFilters, sort, columns, columnTypeRegistry);
    onChange({ filters: config.filters, sort: config.sort });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onChange is a stable setState setter
  }, [rawFilters, sort, columns]);

  const columnById = new Map(columns.map((c) => [c.id, c]));

  function addFilter() {
    const firstColumn = columns[0];
    if (!firstColumn) return;
    const operators = operatorsFor(firstColumn);
    setRawFilters((prev) => [
      ...prev,
      { id: crypto.randomUUID(), columnId: firstColumn.id, operatorKey: operators[0]?.key ?? "", args: [] },
    ]);
  }

  function removeFilter(rowId: string) {
    setRawFilters((prev) => prev.filter((r) => r.id !== rowId));
  }

  function changeColumn(rowId: string, columnId: string) {
    const column = columnById.get(columnId);
    const operators = operatorsFor(column);
    setRawFilters((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, columnId, operatorKey: operators[0]?.key ?? "", args: [] } : r)),
    );
  }

  function changeOperator(rowId: string, operatorKey: string) {
    setRawFilters((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        const column = columnById.get(r.columnId);
        const operator = operatorsFor(column).find((o) => o.key === operatorKey);
        return { ...r, operatorKey, args: new Array(operator?.arity ?? 0).fill("") };
      }),
    );
  }

  function changeArg(rowId: string, index: number, value: string) {
    setRawFilters((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        const args = [...r.args];
        args[index] = value;
        return { ...r, args };
      }),
    );
  }

  return (
    <div style={{ margin: "0.5rem 0 1rem", padding: "0.5rem", border: "1px solid #ddd" }}>
      <strong>Filters</strong>
      {rawFilters.map((row) => {
        const column = columnById.get(row.columnId);
        const operators = operatorsFor(column);
        const operator = operators.find((o) => o.key === row.operatorKey);
        const shadowField = shadowFieldFor(column);
        const inputType = inputTypeFor(shadowField);

        return (
          <div key={row.id} style={rowStyle}>
            <select value={row.columnId} onChange={(e) => changeColumn(row.id, e.target.value)}>
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select value={row.operatorKey} onChange={(e) => changeOperator(row.id, e.target.value)}>
              {operators.map((op) => (
                <option key={op.key} value={op.key}>
                  {op.label}
                </option>
              ))}
            </select>
            {Array.from({ length: operator?.arity ?? 0 }).map((_, i) => (
              <input
                key={i}
                type={inputType}
                style={inputStyle}
                value={row.args[i] ?? ""}
                onChange={(e) => changeArg(row.id, i, e.target.value)}
              />
            ))}
            <button type="button" onClick={() => removeFilter(row.id)} aria-label="Remove filter">
              ×
            </button>
          </div>
        );
      })}
      <button type="button" onClick={addFilter} disabled={columns.length === 0}>
        + Add filter
      </button>

      <div style={{ marginTop: "0.75rem" }}>
        <strong>Sort</strong>{" "}
        <select
          value={sort?.columnId ?? "__manual__"}
          onChange={(e) => {
            const columnId = e.target.value;
            setSort(columnId === "__manual__" ? null : { columnId, direction: sort?.direction ?? "asc" });
          }}
        >
          <option value="__manual__">Manual order</option>
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>{" "}
        {sort?.columnId && (
          <select
            value={sort.direction}
            onChange={(e) => setSort({ columnId: sort.columnId, direction: e.target.value as "asc" | "desc" })}
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        )}
      </div>
    </div>
  );
}
