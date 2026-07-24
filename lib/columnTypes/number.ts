import { z } from "zod";
import type { ColumnType } from "./types";
import { NumberCell, NumberEditor } from "./number.client";

const valueSchema = z.number().nullable();
const settingsSchema = z.object({});

export type NumberValue = z.infer<typeof valueSchema>;
export type NumberSettings = z.infer<typeof settingsSchema>;

export const numberColumn: ColumnType<NumberValue, NumberSettings> = {
  key: "number",
  valueSchema,
  settingsSchema,
  // Unlike text's "" sentinel, 0 is a legitimate distinct value here —
  // null is the correct "no value entered" state.
  defaultValue: () => null,

  shadowField: "valueNumber",
  toShadow(ctx) {
    return { valueNumber: ctx.value };
  },

  isEmpty(value) {
    return value === null;
  },

  groupKeys(value) {
    return value === null ? [{ key: "__empty__", label: "No value" }] : [{ key: String(value), label: String(value) }];
  },

  toDisplayString(value) {
    return value === null ? "" : String(value);
  },

  parse(input) {
    const trimmed = input.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  },

  Cell: NumberCell,
  Editor: NumberEditor,
};
