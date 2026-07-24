"use client";

import { useState } from "react";
import { z } from "zod";
import type { CellProps, ColumnType, EditorProps } from "./types";

const valueSchema = z.string().trim();
const settingsSchema = z.object({});

type TextValue = z.infer<typeof valueSchema>;
type TextSettings = z.infer<typeof settingsSchema>;

function TextCell({ value, readOnly }: CellProps<TextValue, TextSettings>) {
  return (
    <div style={{ minHeight: "1.2em", opacity: readOnly ? 0.6 : 1, cursor: readOnly ? "default" : "text" }}>
      {value}
    </div>
  );
}

function TextEditor({ value, onChange, onCancel }: EditorProps<TextValue, TextSettings>) {
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

export const textColumn: ColumnType<TextValue, TextSettings> = {
  key: "text",
  valueSchema,
  settingsSchema,
  defaultValue: () => "",

  shadowField: "valueText",
  toShadow(ctx) {
    return { valueText: ctx.value.length > 0 ? ctx.value : null };
  },

  isEmpty(value) {
    return value.length === 0;
  },

  groupKeys(value) {
    // Decision 3: empty gets its own explicit bucket rather than
    // disappearing from a group-by/Kanban view.
    return value.length === 0 ? [{ key: "__empty__", label: "No value" }] : [{ key: value, label: value }];
  },

  toDisplayString(value) {
    return value;
  },

  parse(input) {
    return input.trim();
  },

  Cell: TextCell,
  Editor: TextEditor,
};
