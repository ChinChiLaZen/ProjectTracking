"use client";

import type { CellProps, EditorProps } from "./types";
import type { DropdownValue, DropdownSettings } from "./dropdown";

// Duplicated from dropdown.ts's resolveOption — see that copy's comment for
// why (avoiding a circular import between the logic and UI files).
function resolveOption(value: DropdownValue, settings: DropdownSettings) {
  return value === null ? null : (settings.options.find((o) => o.id === value) ?? null);
}

// Plain text, not a colored pill — the visual distinction from `status`
// (a colored workflow field). `color`, if set, is still available in
// settings but isn't rendered here; a future variant could use it.
export function DropdownCell({ value, settings, readOnly }: CellProps<DropdownValue, DropdownSettings>) {
  const option = resolveOption(value, settings);
  return (
    <div style={{ opacity: readOnly ? 0.6 : 1, cursor: readOnly ? "default" : "pointer" }}>
      {option ? option.label : (value ?? "")}
    </div>
  );
}

export function DropdownEditor({ value, settings, onChange, onCancel }: EditorProps<DropdownValue, DropdownSettings>) {
  return (
    <select
      autoFocus
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <option value="">—</option>
      {settings.options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
