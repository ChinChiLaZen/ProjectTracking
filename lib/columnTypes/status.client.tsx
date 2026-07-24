"use client";

import type { CellProps, EditorProps } from "./types";
import type { StatusValue, StatusSettings } from "./status";

// Duplicated from status.ts's resolveOption — see that copy's comment for
// why (avoiding a circular import between the logic and UI files).
function resolveOption(value: StatusValue, settings: StatusSettings) {
  return value === null ? null : (settings.options.find((o) => o.id === value) ?? null);
}

export function StatusCell({ value, settings, readOnly }: CellProps<StatusValue, StatusSettings>) {
  const option = resolveOption(value, settings);
  return (
    <div style={{ opacity: readOnly ? 0.6 : 1, cursor: readOnly ? "default" : "pointer" }}>
      {option ? (
        <span style={{ background: option.color ?? "#eee", padding: "0.1rem 0.5rem", borderRadius: 4 }}>
          {option.label}
        </span>
      ) : (
        // Falls back to the raw id if the option was since deleted from
        // settings — no reconcileValues migration wired up yet (§4.2
        // Decision 4 exists for exactly this; there's no column-settings-
        // update procedure at all yet to call it from).
        (value ?? "")
      )}
    </div>
  );
}

export function StatusEditor({ value, settings, onChange, onCancel }: EditorProps<StatusValue, StatusSettings>) {
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
