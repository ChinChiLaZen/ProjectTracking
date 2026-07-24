import { z } from "zod";
import type { ColumnType } from "./types";
import { StatusCell, StatusEditor } from "./status.client";

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

export type StatusValue = z.infer<typeof valueSchema>;
export type StatusSettings = z.infer<typeof settingsSchema>;

// Duplicated (also in status.client.tsx) rather than shared — sharing it
// would require status.client.tsx to import a value from this file while
// this file already imports Cell/Editor from status.client.tsx, a real
// circular runtime dependency. This one-liner is cheap to keep in sync.
function resolveOption(value: StatusValue, settings: StatusSettings) {
  return value === null ? null : (settings.options.find((o) => o.id === value) ?? null);
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
