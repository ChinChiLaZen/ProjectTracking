"use client";

import { useState } from "react";
import type { CellProps, EditorProps } from "./types";
import type { PersonValue, PersonSettings } from "./person";

// Duplicated from person.ts's splitIds — see that copy's comment for why
// (avoiding a circular import between the logic and UI files).
function splitIds(input: string): string[] {
  return input
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

export function PersonCell({ value, readOnly }: CellProps<PersonValue, PersonSettings>) {
  return (
    <div style={{ minHeight: "1.2em", opacity: readOnly ? 0.6 : 1, cursor: readOnly ? "default" : "text" }}>
      {value.join(", ")}
    </div>
  );
}

// KNOWN UI GAP (Session 5): no real people-picker — there's no
// "list board members" query yet, and CellProps/EditorProps don't carry a
// way to fetch one. This is a plain comma-separated user-id text input,
// a placeholder, not a finished UX. A real picker is Phase 2/3 UI work.
export function PersonEditor({ value, onChange, onCancel }: EditorProps<PersonValue, PersonSettings>) {
  const [draft, setDraft] = useState(value.join(", "));

  function commit() {
    onChange(splitIds(draft));
  }

  return (
    <input
      autoFocus
      value={draft}
      placeholder="user id, user id, ..."
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") onCancel();
      }}
    />
  );
}
