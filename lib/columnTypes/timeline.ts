import { z } from "zod";
import type { ColumnType } from "./types";
import { TimelineCell, TimelineEditor } from "./timeline.client";

// ColumnValue.valueDate/valueDateEnd (§4.2) have existed since Session 1
// specifically for this type. No schema or registry-contract change needed —
// Shadow already allows valueDateEnd as an extra field regardless of the
// declared shadowField (lib/columnTypes/types.ts).
const rangeSchema = z
  .object({ start: z.iso.date(), end: z.iso.date() })
  .refine((v) => v.end >= v.start, { message: "end must be on or after start" });
const valueSchema = rangeSchema.nullable();
const settingsSchema = z.object({});

export type TimelineValue = z.infer<typeof valueSchema>;
export type TimelineSettings = z.infer<typeof settingsSchema>;

export const timelineColumn: ColumnType<TimelineValue, TimelineSettings> = {
  key: "timeline",
  valueSchema,
  settingsSchema,
  defaultValue: () => null,

  // shadowField drives filtering/sorting off the *start* date (reuses
  // valueDate's existing operator set — equals/before/after/between/is_empty
  // — honestly read as "when does this timeline start"). toShadow also
  // projects valueDateEnd so a future range-aware consumer (e.g. Gantt) has
  // it without a shadowField change here.
  shadowField: "valueDate",
  toShadow(ctx) {
    // Same UTC-midnight simplification date.ts already carries (Session 5,
    // ctx.timeZone read but unused) — not solved or worsened here.
    void ctx.timeZone;
    if (ctx.value === null) return { valueDate: null, valueDateEnd: null };
    return {
      valueDate: new Date(`${ctx.value.start}T00:00:00Z`),
      valueDateEnd: new Date(`${ctx.value.end}T00:00:00Z`),
    };
  },

  isEmpty(value) {
    return value === null;
  },

  groupKeys(value) {
    // Buckets by start date, same convention as date.groupKeys — Calendar
    // (Session 10) shows a timeline item on its start day only; full
    // range-spanning display is deferred to a future Gantt-focused session.
    return value === null ? [{ key: "__empty__", label: "No value" }] : [{ key: value.start, label: value.start }];
  },

  toDisplayString(value) {
    return value === null ? "" : `${value.start} → ${value.end}`;
  },

  // CSV/paste format: "start,end" (two ISO dates). Not a polished import
  // UX — matches every other type's "good enough" parse.
  parse(input) {
    const parts = input.split(",").map((p) => p.trim());
    if (parts.length !== 2) return null;
    const result = rangeSchema.safeParse({ start: parts[0], end: parts[1] });
    return result.success ? result.data : null;
  },

  Cell: TimelineCell,
  Editor: TimelineEditor,
};
