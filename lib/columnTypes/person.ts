import { z } from "zod";
import type { ColumnType } from "./types";
import { PersonCell, PersonEditor } from "./person.client";

const valueSchema = z.array(z.string());
const settingsSchema = z.object({ allowMultiple: z.boolean().default(true) });

export type PersonValue = z.infer<typeof valueSchema>;
export type PersonSettings = z.infer<typeof settingsSchema>;

// Duplicated (also in person.client.tsx) rather than shared — sharing it
// would require person.client.tsx to import a value from this file while
// this file already imports Cell/Editor from person.client.tsx, a real
// circular runtime dependency. This one-liner is cheap to keep in sync.
function splitIds(input: string): string[] {
  return input
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
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
