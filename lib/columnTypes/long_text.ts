import { z } from "zod";
import type { ColumnType } from "./types";
import { LongTextCell, LongTextEditor } from "./long_text.client";

// Functionally identical to text.ts (same value/shadow/empty/group/parse
// semantics — §4.3 groups the two together) — the only real difference is
// presentational: a <textarea> instead of an <input>.
const valueSchema = z.string().trim();
const settingsSchema = z.object({});

export type LongTextValue = z.infer<typeof valueSchema>;
export type LongTextSettings = z.infer<typeof settingsSchema>;

export const longTextColumn: ColumnType<LongTextValue, LongTextSettings> = {
  key: "long_text",
  valueSchema,
  settingsSchema,
  defaultValue: () => "",

  shadowField: "valueText",
  toShadow(ctx) {
    return { valueText: ctx.value.length > 0 ? ctx.value : null };
  },

  isEmpty(value) {
    return value.length === 0;
  },

  groupKeys(value) {
    return value.length === 0 ? [{ key: "__empty__", label: "No value" }] : [{ key: value, label: value }];
  },

  toDisplayString(value) {
    return value;
  },

  parse(input) {
    return input.trim();
  },

  Cell: LongTextCell,
  Editor: LongTextEditor,
};
