import { z } from "zod";
import type { ColumnType } from "./types";
import { TextCell, TextEditor } from "./text.client";

const valueSchema = z.string().trim();
const settingsSchema = z.object({});

export type TextValue = z.infer<typeof valueSchema>;
export type TextSettings = z.infer<typeof settingsSchema>;

export const textColumn: ColumnType<TextValue, TextSettings> = {
  key: "text",
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
    // Decision 3: empty gets its own explicit bucket rather than
    // disappearing from a group-by/Kanban view.
    return value.length === 0 ? [{ key: "__empty__", label: "No value" }] : [{ key: value, label: value }];
  },

  toDisplayString(value) {
    return value;
  },

  parse(input) {
    return input.trim();
  },

  Cell: TextCell,
  Editor: TextEditor,
};
