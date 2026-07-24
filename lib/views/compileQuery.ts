import type { Prisma } from "../../generated/prisma/client";
import { getColumnType } from "../columnTypes/types";
import { getOperator } from "../columnTypes/operators";
import type { ColumnTypeRegistry, ShadowField } from "../columnTypes/types";
import type { ViewConfig } from "./viewConfig";

export type CompiledSort = {
  columnId: string;
  shadowField: ShadowField;
  direction: "asc" | "desc";
};

export type CompiledQuery = {
  itemWhere: Prisma.ItemWhereInput;
  sort: CompiledSort | null;
};

// §6: "Filters compile to SQL against shadow columns. Never findMany() then
// .filter() in JS." Each filter clause becomes a `values: { some: {...} } }`
// condition on Item, ANDed together (§7's automation-condition semantics).
export function compileViewConfig(
  viewConfig: ViewConfig,
  columns: Array<{ id: string; key: string }>,
  registry: ColumnTypeRegistry,
): CompiledQuery {
  const columnById = new Map(columns.map((c) => [c.id, c]));

  const filterConditions: Prisma.ItemWhereInput[] = viewConfig.filters.map((filter) => {
    const column = columnById.get(filter.columnId);
    if (!column) {
      throw new Error(`Filter references unknown column "${filter.columnId}"`);
    }
    const columnType = getColumnType(registry, column.key);
    const operator = getOperator(columnType.shadowField, filter.operatorKey, columnType.extraOperators);
    const fragment = operator.toSql(columnType.shadowField, filter.args);
    return { values: { some: { columnId: filter.columnId, ...fragment } } };
  });

  const itemWhere: Prisma.ItemWhereInput = filterConditions.length > 0 ? { AND: filterConditions } : {};

  let sort: CompiledSort | null = null;
  if (viewConfig.sort?.columnId) {
    const column = columnById.get(viewConfig.sort.columnId);
    if (!column) {
      throw new Error(`Sort references unknown column "${viewConfig.sort.columnId}"`);
    }
    const columnType = getColumnType(registry, column.key);
    sort = { columnId: column.id, shadowField: columnType.shadowField, direction: viewConfig.sort.direction };
  }

  return { itemWhere, sort };
}
