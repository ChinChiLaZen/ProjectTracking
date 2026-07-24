import { z } from "zod";
import type { ColumnType } from "./types";
import { DropdownCell, DropdownEditor } from "./dropdown.client";

// Same option-set shape as status (§4.2) — single-select, valueText-shadowed
// (types.ts's own Decision 2 comment already grouped dropdown with
// text/long_text/status on valueText before this file existed). The real
// difference from status is semantic, not structural: status is a colored
// workflow field, dropdown is a plain categorical one (e.g. "Priority").
// `color` stays optional/available rather than removed, so a board that
// wants a lightly-tagged dropdown isn't blocked from it.
const optionSchema = z.object({
  id: z.string(),
  label: z.string(),
  color: z.string().optional(),
  order: z.number(),
});

const valueSchema = z.string().nullable();
const settingsSchema = z.object({ options: z.array(optionSchema).default([]) });

export type DropdownValue = z.infer<typeof valueSchema>;
export type DropdownSettings = z.infer<typeof settingsSchema>;

// Duplicated (also in dropdown.client.tsx) rather than shared — sharing it
// would require dropdown.client.tsx to import a value from this file while
// this file already imports Cell/Editor from dropdown.client.tsx, a real
// circular runtime dependency. This one-liner is cheap to keep in sync.
function resolveOption(value: DropdownValue, settings: DropdownSettings) {
  return value === null ? null : (settings.options.find((o) => o.id === value) ?? null);
}

export const dropdownColumn: ColumnType<DropdownValue, DropdownSettings> = {
  key: "dropdown",
  valueSchema,
  settingsSchema,
  defaultValue: () => null,

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
    const match = settings.options.find((o) => o.label.toLowerCase() === trimmed.toLowerCase());
    return match?.id ?? null;
  },

  Cell: DropdownCell,
  Editor: DropdownEditor,
};
