"use client";

import { useState } from "react";
import { z } from "zod";
import type { CellProps, ColumnType, EditorProps } from "./types";

const valueSchema = z.array(z.string());
const settingsSchema = z.object({ allowMultiple: z.boolean().default(true) });

type PersonValue = z.infer<typeof valueSchema>;
type PersonSettings = z.infer<typeof settingsSchema>;

function splitIds(input: string): string[] {
  return input
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

function PersonCell({ value, readOnly }: CellProps<PersonValue, PersonSettings>) {
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
function PersonEditor({ value, onChange, onCancel }: EditorProps<PersonValue, PersonSettings>) {
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

export const personColumn: ColumnType<PersonValue, PersonSettings> = {
  key: "person",
  valueSchema,
  settingsSchema,
  defaultValue: () => [],

  shadowField: "valueRefIds",
  toShadow(ctx) {
    return { valueRefIds: ctx.value };
  },

  isEmpty(value) {
    return value.length === 0;
  },

  groupKeys(value) {
    // Decision 3: a multi-assignee item lands in one bucket per assignee
    // (e.g. two Kanban columns), not a single combined key.
    if (value.length === 0) return [{ key: "__empty__", label: "No value" }];
    return value.map((userId) => ({ key: userId, label: userId }));
  },

  toDisplayString(value) {
    return value.join(", ");
  },

  parse(input) {
    return splitIds(input);
  },

  Cell: PersonCell,
  Editor: PersonEditor,
};
