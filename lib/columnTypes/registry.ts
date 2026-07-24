import type { ColumnTypeRegistry } from "./types";
import { textColumn } from "./text";

// The ONLY place that maps a ColumnDefinition.key to its implementation
// (§1 rule 6). Lookup itself lives in ./types (getColumnType) — this file
// just supplies the data.
export const columnTypeRegistry: ColumnTypeRegistry = {
  text: textColumn,
};
