import type { FilterOperatorDef, OperatorSets, ShadowField } from "./types";

// Decision 2 (types.ts): operators belong to the shadow field, not the
// column type. Every column type that uses a given shadow field inherits
// this set; `extraOperators` is the escape hatch for anything beyond it.
export const operatorSets: OperatorSets = {
  valueText: [
    { key: "equals", label: "Is", arity: 1, toSql: (col, args) => ({ [col]: args[0] as string }) },
    {
      key: "contains",
      label: "Contains",
      arity: 1,
      toSql: (col, args) => ({ [col]: { contains: args[0] as string, mode: "insensitive" } }),
    },
    { key: "is_empty", label: "Is empty", arity: 0, toSql: (col) => ({ [col]: null }) },
  ],

  valueNumber: [
    { key: "equals", label: "=", arity: 1, toSql: (col, args) => ({ [col]: args[0] as number }) },
    { key: "gt", label: ">", arity: 1, toSql: (col, args) => ({ [col]: { gt: args[0] as number } }) },
    { key: "lt", label: "<", arity: 1, toSql: (col, args) => ({ [col]: { lt: args[0] as number } }) },
    {
      key: "between",
      label: "Between",
      arity: 2,
      toSql: (col, args) => ({ [col]: { gte: args[0] as number, lte: args[1] as number } }),
    },
    { key: "is_empty", label: "Is empty", arity: 0, toSql: (col) => ({ [col]: null }) },
  ],

  valueDate: [
    { key: "equals", label: "On", arity: 1, toSql: (col, args) => ({ [col]: args[0] as Date }) },
    { key: "before", label: "Before", arity: 1, toSql: (col, args) => ({ [col]: { lt: args[0] as Date } }) },
    { key: "after", label: "After", arity: 1, toSql: (col, args) => ({ [col]: { gt: args[0] as Date } }) },
    {
      key: "between",
      label: "Between",
      arity: 2,
      toSql: (col, args) => ({ [col]: { gte: args[0] as Date, lte: args[1] as Date } }),
    },
    { key: "is_empty", label: "Is empty", arity: 0, toSql: (col) => ({ [col]: null }) },
  ],

  valueRefIds: [
    { key: "contains", label: "Includes", arity: 1, toSql: (col, args) => ({ [col]: { has: args[0] as string } }) },
    { key: "is_empty", label: "Is empty", arity: 0, toSql: (col) => ({ [col]: { isEmpty: true } }) },
  ],
};

export function getOperator(shadowField: ShadowField, key: string, extraOperators: FilterOperatorDef[] = []): FilterOperatorDef {
  const operator = [...operatorSets[shadowField], ...extraOperators].find((o) => o.key === key);
  if (!operator) {
    throw new Error(`Unknown filter operator "${key}" for shadow field "${shadowField}"`);
  }
  return operator;
}
