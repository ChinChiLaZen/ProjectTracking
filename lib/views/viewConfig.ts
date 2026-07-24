import { z } from "zod";

// §6: "viewConfig is a single Zod-validated object... Saved views persist
// exactly this object." No View model exists yet (that's Phase 2) — this
// session it's a per-request input, not persisted. Only `filters`/`sort`
// are exercised this session; the rest is declared now so Kanban/Calendar/
// Chart (Phase 2) don't need a schema change to fill in.
export const filterClauseSchema = z.object({
  columnId: z.string(),
  operatorKey: z.string(),
  args: z.array(z.unknown()).default([]),
});

export const sortClauseSchema = z.object({
  // null = manual rank order (the default) — an explicit column sort
  // switches the query to the ColumnValue-rooted shape (see compileQuery.ts).
  columnId: z.string().nullable(),
  direction: z.enum(["asc", "desc"]),
});

export const viewConfigSchema = z.object({
  type: z.enum(["table", "kanban", "calendar", "chart", "gantt"]).default("table"),
  filters: z.array(filterClauseSchema).default([]),
  sort: sortClauseSchema.nullable().default(null),
  groupBy: z.string().nullable().default(null),
  visibleColumns: z.array(z.string()).nullable().default(null),
  swimlaneBy: z.string().nullable().optional(),
  dateColumnId: z.string().nullable().optional(),
  chartConfig: z.unknown().nullable().optional(),
});

export type ViewConfig = z.infer<typeof viewConfigSchema>;
export type FilterClause = z.infer<typeof filterClauseSchema>;
export type SortClause = z.infer<typeof sortClauseSchema>;

export const defaultViewConfig: ViewConfig = viewConfigSchema.parse({});
