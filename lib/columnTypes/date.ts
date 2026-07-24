import { z } from "zod";
import type { ColumnType } from "./types";
import { DateCell, DateEditor } from "./date.client";

const valueSchema = z.iso.date().nullable();
const settingsSchema = z.object({});

export type DateValue = z.infer<typeof valueSchema>;
export type DateSettings = z.infer<typeof settingsSchema>;

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
