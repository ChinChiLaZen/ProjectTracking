"use client";

import { useState } from "react";
import { z } from "zod";
import type { CellProps, ColumnType, EditorProps } from "./types";

// Functionally identical to text.tsx (same value/shadow/empty/group/parse
// semantics — §4.3 groups the two together) — the only real difference is
// presentational: a <textarea> instead of an <input>.
const valueSchema = z.string().trim();
const settingsSchema = z.object({});

type LongTextValue = z.infer<typeof valueSchema>;
type LongTextSettings = z.infer<typeof settingsSchema>;

function LongTextCell({ value, readOnly }: CellProps<LongTextValue, LongTextSettings>) {
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

function LongTextEditor({ value, onChange, onCancel }: EditorProps<LongTextValue, LongTextSettings>) {
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

export const longTextColumn: ColumnType<LongTextValue, LongTextSettings> = {
  key: "long_text",
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
    return value.length === 0 ? [{ key: "__empty__", label: "No value" }] : [{ key: value, label: value }];
  },

  toDisplayString(value) {
    return value;
  },

  parse(input) {
    return input.trim();
  },

  Cell: LongTextCell,
  Editor: LongTextEditor,
};
