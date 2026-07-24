import type { ColumnTypeRegistry } from "./types";
import { textColumn } from "./text";
import { longTextColumn } from "./long_text";
import { statusColumn } from "./status";
import { personColumn } from "./person";
import { dateColumn } from "./date";
import { numberColumn } from "./number";
import { checkboxColumn } from "./checkbox";

// The ONLY place that maps a ColumnDefinition.key to its implementation
// (§1 rule 6). Lookup itself lives in ./types (getColumnType) — this file
// just supplies the data.
export const columnTypeRegistry: ColumnTypeRegistry = {
  text: textColumn,
  long_text: longTextColumn,
  status: statusColumn,
  person: personColumn,
  date: dateColumn,
  number: numberColumn,
  checkbox: checkboxColumn,
};
