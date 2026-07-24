import { useState } from "react";
import { z } from "zod";
import type { CellProps, ColumnType, EditorProps } from "./types";

const valueSchema = z.number().nullable();
const settingsSchema = z.object({});

type NumberValue = z.infer<typeof valueSchema>;
type NumberSettings = z.infer<typeof settingsSchema>;

function NumberCell({ value, readOnly }: CellProps<NumberValue, NumberSettings>) {
  return (
    <div style={{ minHeight: "1.2em", opacity: readOnly ? 0.6 : 1, cursor: readOnly ? "default" : "text" }}>
      {value ?? ""}
    </div>
  );
}

function NumberEditor({ value, onChange, onCancel }: EditorProps<NumberValue, NumberSettings>) {
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

export const numberColumn: ColumnType<NumberValue, NumberSettings> = {
  key: "number",
  valueSchema,
  settingsSchema,
  // Unlike text's "" sentinel, 0 is a legitimate distinct value here —
  // null is the correct "no value entered" state.
  defaultValue: () => null,

  shadowField: "valueNumber",
  toShadow(ctx) {
    return { valueNumber: ctx.value };
  },

  isEmpty(value) {
    return value === null;
  },

  groupKeys(value) {
    return value === null ? [{ key: "__empty__", label: "No value" }] : [{ key: String(value), label: String(value) }];
  },

  toDisplayString(value) {
    return value === null ? "" : String(value);
  },

  parse(input) {
    const trimmed = input.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  },

  Cell: NumberCell,
  Editor: NumberEditor,
};
