"use client";

import { useState } from "react";
import type { CellProps, EditorProps } from "./types";
import type { LongTextValue, LongTextSettings } from "./long_text";

export function LongTextCell({ value, readOnly }: CellProps<LongTextValue, LongTextSettings>) {
  return (
    <div
      style={{
        minHeight: "1.2em",
        maxHeight: "3.6em",
        overflow: "hidden",
        whiteSpace: "pre-wrap",
        opacity: readOnly ? 0.6 : 1,
        cursor: readOnly ? "default" : "text",
      }}
    >
      {value}
    </div>
  );
}

export function LongTextEditor({ value, onChange, onCancel }: EditorProps<LongTextValue, LongTextSettings>) {
  const [draft, setDraft] = useState(value);

  return (
    <textarea
      autoFocus
      rows={4}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onChange(draft)}
      onKeyDown={(e) => {
        // Enter inserts a newline (it's a textarea); Escape still cancels.
        // Commit happens on blur, unlike single-line text's Enter-to-commit.
        if (e.key === "Escape") onCancel();
      }}
    />
  );
}
