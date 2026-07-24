"use client";

import { useState } from "react";
import type { CellProps, EditorProps } from "./types";
import type { TextValue, TextSettings } from "./text";

export function TextCell({ value, readOnly }: CellProps<TextValue, TextSettings>) {
  return (
    <div style={{ minHeight: "1.2em", opacity: readOnly ? 0.6 : 1, cursor: readOnly ? "default" : "text" }}>
      {value}
    </div>
  );
}

export function TextEditor({ value, onChange, onCancel }: EditorProps<TextValue, TextSettings>) {
  const [draft, setDraft] = useState(value);

  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onChange(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onChange(draft);
        if (e.key === "Escape") onCancel();
      }}
    />
  );
}
