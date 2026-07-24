"use client";

import { z } from "zod";
import type { CellProps, ColumnType, EditorProps } from "./types";

// §4.2: option sets live on ColumnDefinition.settings as {id,label,color,order}[];
// values reference optionId, never the label, so renaming an option doesn't
// rewrite every ColumnValue.
const optionSchema = z.object({
  id: z.string(),
  label: z.string(),
  color: z.string().optional(),
  order: z.number(),
});

const valueSchema = z.string().nullable();
const settingsSchema = z.object({ options: z.array(optionSchema).default([]) });

type StatusValue = z.infer<typeof valueSchema>;
type StatusSettings = z.infer<typeof settingsSchema>;

function resolveOption(value: StatusValue, settings: StatusSettings) {
  return value === null ? null : (settings.options.find((o) => o.id === value) ?? null);
}

function StatusCell({ value, settings, readOnly }: CellProps<StatusValue, StatusSettings>) {
  const option = resolveOption(value, settings);
  return (
    <div style={{ opacity: readOnly ? 0.6 : 1, cursor: readOnly ? "default" : "pointer" }}>
      {option ? (
        <span style={{ background: option.color ?? "#eee", padding: "0.1rem 0.5rem", borderRadius: 4 }}>
          {option.label}
        </span>
      ) : (
        // Falls back to the raw id if the option was since deleted from
        // settings — no reconcileValues migration wired up yet (§4.2
        // Decision 4 exists for exactly this; there's no column-settings-
        // update procedure at all yet to call it from).
        (value ?? "")
      )}
    </div>
  );
}

function StatusEditor({ value, settings, onChange, onCancel }: EditorProps<StatusValue, StatusSettings>) {
  return (
    <select
      autoFocus
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <option value="">—</option>
      {settings.options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export const statusColumn: ColumnType<StatusValue, StatusSettings> = {
  key: "status",
  valueSchema,
  settingsSchema,
  defaultValue: () => null,

  // Stores the raw optionId in valueText. KNOWN LIMITATION (Session 5):
  // this makes ORDER BY valueText sort alphabetically by id, not by the
  // option's configured `order` — nothing depends on status sort order
  // yet (no Kanban view), so not solved here. Revisit if/when it is.
  shadowField: "valueText",
  toShadow(ctx) {
    return { valueText: ctx.value };
  },

  isEmpty(value) {
    return value === null;
  },

  groupKeys(value, settings) {
    if (value === null) return [{ key: "__empty__", label: "No value" }];
    const option = resolveOption(value, settings);
    return [{ key: value, label: option?.label ?? value, color: option?.color }];
  },

  toDisplayString(value, settings) {
    return resolveOption(value, settings)?.label ?? "";
  },

  parse(input, settings) {
    const trimmed = input.trim();
    if (trimmed === "") return null;
    // CSV/paste import gives a label, not an id — resolve by label.
    const match = settings.options.find((o) => o.label.toLowerCase() === trimmed.toLowerCase());
    return match?.id ?? null;
  },

  Cell: StatusCell,
  Editor: StatusEditor,
};
