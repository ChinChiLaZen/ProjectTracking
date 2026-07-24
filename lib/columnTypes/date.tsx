import { useState } from "react";
import { z } from "zod";
import type { CellProps, ColumnType, EditorProps } from "./types";

const valueSchema = z.iso.date().nullable();
const settingsSchema = z.object({});

type DateValue = z.infer<typeof valueSchema>;
type DateSettings = z.infer<typeof settingsSchema>;

function DateCell({ value, readOnly }: CellProps<DateValue, DateSettings>) {
  return (
    <div style={{ minHeight: "1.2em", opacity: readOnly ? 0.6 : 1, cursor: readOnly ? "default" : "text" }}>
      {value ?? ""}
    </div>
  );
}

function DateEditor({ value, onChange, onCancel }: EditorProps<DateValue, DateSettings>) {
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

export const dateColumn: ColumnType<DateValue, DateSettings> = {
  key: "date",
  valueSchema,
  settingsSchema,
  defaultValue: () => null,

  shadowField: "valueDate",
  toShadow(ctx) {
    // KNOWN SIMPLIFICATION (Session 5): interpreted as UTC midnight, not
    // the board's local timezone (ctx.timeZone is read but unused below).
    // Correct enough for filtering/sorting by date; not correct for "what
    // calendar day is this" right at a local-midnight boundary. Revisit
    // when Calendar (Phase 2) actually needs local-timezone correctness —
    // flagged rather than silently assumed correct.
    void ctx.timeZone;
    return { valueDate: ctx.value === null ? null : new Date(`${ctx.value}T00:00:00Z`) };
  },

  isEmpty(value) {
    return value === null;
  },

  groupKeys(value) {
    return value === null ? [{ key: "__empty__", label: "No value" }] : [{ key: value, label: value }];
  },

  toDisplayString(value) {
    return value ?? "";
  },

  parse(input) {
    const trimmed = input.trim();
    return valueSchema.safeParse(trimmed === "" ? null : trimmed).success
      ? (trimmed === "" ? null : trimmed)
      : null;
  },

  Cell: DateCell,
  Editor: DateEditor,
};
