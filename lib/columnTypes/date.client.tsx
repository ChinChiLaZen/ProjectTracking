"use client";

import { useState } from "react";
import type { CellProps, EditorProps } from "./types";
import type { DateValue, DateSettings } from "./date";

export function DateCell({ value, readOnly }: CellProps<DateValue, DateSettings>) {
  return (
    <div style={{ minHeight: "1.2em", opacity: readOnly ? 0.6 : 1, cursor: readOnly ? "default" : "text" }}>
      {value ?? ""}
    </div>
  );
}

export function DateEditor({ value, onChange, onCancel }: EditorProps<DateValue, DateSettings>) {
  const [draft, setDraft] = useState(value ?? "");

  return (
    <input
      type="date"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onChange(draft === "" ? null : draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onChange(draft === "" ? null : draft);
        if (e.key === "Escape") onCancel();
      }}
    />
  );
}
