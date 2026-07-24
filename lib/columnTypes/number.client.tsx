"use client";

import { useState } from "react";
import type { CellProps, EditorProps } from "./types";
import type { NumberValue, NumberSettings } from "./number";

export function NumberCell({ value, readOnly }: CellProps<NumberValue, NumberSettings>) {
  return (
    <div style={{ minHeight: "1.2em", opacity: readOnly ? 0.6 : 1, cursor: readOnly ? "default" : "text" }}>
      {value ?? ""}
    </div>
  );
}

export function NumberEditor({ value, onChange, onCancel }: EditorProps<NumberValue, NumberSettings>) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));

  function commit() {
    onChange(draft.trim() === "" ? null : Number(draft));
  }

  return (
    <input
      type="number"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") onCancel();
      }}
    />
  );
}
