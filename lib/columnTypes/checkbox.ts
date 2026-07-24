import { z } from "zod";
import type { ColumnType } from "./types";
import { CheckboxCell, CheckboxEditor } from "./checkbox.client";

const valueSchema = z.boolean();
const settingsSchema = z.object({});

export type CheckboxValue = z.infer<typeof valueSchema>;
export type CheckboxSettings = z.infer<typeof settingsSchema>;

export const checkboxColumn: ColumnType<CheckboxValue, CheckboxSettings> = {
  key: "checkbox",
  valueSchema,
  settingsSchema,
  defaultValue: () => false,

  // Reuses the numeric shadow column (stored as 1/0) rather than adding a
  // 5th ShadowField variant for a single boolean-valued type.
  shadowField: "valueNumber",
  toShadow(ctx) {
    return { valueNumber: ctx.value ? 1 : 0 };
  },

  isEmpty(value) {
    return value === false;
  },

  groupKeys(value) {
    return value ? [{ key: "checked", label: "Checked" }] : [{ key: "unchecked", label: "Unchecked" }];
  },

  toDisplayString(value) {
    return value ? "Yes" : "No";
  },

  parse(input) {
    const normalized = input.trim().toLowerCase();
    return normalized === "true" || normalized === "yes" || normalized === "1";
  },

  Cell: CheckboxCell,
  Editor: CheckboxEditor,
};
