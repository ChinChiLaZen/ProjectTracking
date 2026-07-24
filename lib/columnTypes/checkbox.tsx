"use client";

import { z } from "zod";
import type { CellProps, ColumnType, EditorProps } from "./types";

const valueSchema = z.boolean();
const settingsSchema = z.object({});

type CheckboxValue = z.infer<typeof valueSchema>;
type CheckboxSettings = z.infer<typeof settingsSchema>;

function CheckboxCell({ value, readOnly }: CellProps<CheckboxValue, CheckboxSettings>) {
  return <input type="checkbox" checked={value} readOnly disabled={readOnly} />;
}

// No draft/commit step — a checkbox toggles and commits in the same
// interaction, unlike text/number's click-to-edit-then-confirm flow.
function CheckboxEditor({ value, onChange }: EditorProps<CheckboxValue, CheckboxSettings>) {
  return <input type="checkbox" autoFocus checked={value} onChange={(e) => onChange(e.target.checked)} />;
}

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
