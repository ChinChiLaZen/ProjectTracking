"use client";

import type { CellProps, EditorProps } from "./types";
import type { CheckboxValue, CheckboxSettings } from "./checkbox";

export function CheckboxCell({ value, readOnly }: CellProps<CheckboxValue, CheckboxSettings>) {
  return <input type="checkbox" checked={value} readOnly disabled={readOnly} />;
}

// No draft/commit step — a checkbox toggles and commits in the same
// interaction, unlike text/number's click-to-edit-then-confirm flow.
export function CheckboxEditor({ value, onChange }: EditorProps<CheckboxValue, CheckboxSettings>) {
  return <input type="checkbox" autoFocus checked={value} onChange={(e) => onChange(e.target.checked)} />;
}
