"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { getMonthGrid } from "@/lib/views/calendarGrid";
import type { ViewConfig } from "@/lib/views/viewConfig";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/routers/_app";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type BoardShell = RouterOutputs["board"]["get"];
type BoardColumn = BoardShell["columns"][number];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// A `date` column's canonical value is a plain "YYYY-MM-DD" string; a
// `timeline` column's (Session 11) is `{start, end}` — bucket a timeline
// item on its start day. Full range-spanning display across multiple day
// cells is deferred to a future Gantt-focused session (§6 treats Calendar
// and Gantt as separate views); this just keeps a timeline item from
// silently vanishing when chosen as Calendar's date column.
function dayKeyForDateValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "start" in value && typeof (value as { start: unknown }).start === "string") {
    return (value as { start: string }).start;
  }
  return null;
}

// One real month at a time — no week/day views, no "unscheduled items"
// list (an item with no value for dateColumn just doesn't appear). Query
// range = the rendered grid (may dip into adjacent months for a full
// Sun–Sat layout), not the calendar month itself, so a padding-day cell's
// items still show up. Read-only this session — no drag-to-reschedule;
// use Table view's inline date editor to change an item's date.
export function CalendarBoard({
  boardId,
  dateColumn,
  viewConfig,
}: {
  boardId: string;
  dateColumn: BoardColumn;
  viewConfig: ViewConfig;
}) {
  const today = new Date();
  const [year, setYear] = useState(today.getUTCFullYear());
  const [month, setMonth] = useState(today.getUTCMonth());

  const grid = getMonthGrid(year, month);
  const rangeStart = grid.gridStart.toISOString();
  const rangeEnd = grid.gridEnd.toISOString();

  const query = trpc.item.listByDateRange.useQuery({
    boardId,
    dateColumnId: dateColumn.id,
    rangeStart,
    rangeEnd,
    viewConfig,
  });

  const itemsByDate = new Map<string, { id: string; name: string }[]>();
  for (const value of query.data?.values ?? []) {
    if (value.columnId !== dateColumn.id) continue;
    const dayKey = dayKeyForDateValue(value.value);
    if (dayKey === null) continue;
    const item = query.data?.items.find((i) => i.id === value.itemId);
    if (!item) continue;
    const list = itemsByDate.get(dayKey) ?? [];
    list.push({ id: item.id, name: item.name });
    itemsByDate.set(dayKey, list);
  }

  function goToPreviousMonth() {
    if (month === 0) {
      setYear((y) => y - 1);
      setMonth(11);
    } else {
      setMonth((m) => m - 1);
    }
  }

  function goToNextMonth() {
    if (month === 11) {
      setYear((y) => y + 1);
      setMonth(0);
    } else {
      setMonth((m) => m + 1);
    }
  }

  const todayIso = isoDate(today);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
        <button type="button" onClick={goToPreviousMonth} aria-label="Previous month">
          ◀
        </button>
        <strong>
          {MONTH_NAMES[month]} {year}
        </strong>
        <button type="button" onClick={goToNextMonth} aria-label="Next month">
          ▶
        </button>
        {query.isLoading && <span style={{ color: "#888" }}>Loading…</span>}
        {query.error && <span style={{ color: "crimson" }}>{query.error.message}</span>}
      </div>
      <div role="table" style={{ width: "100%", borderCollapse: "collapse" }}>
        <div role="row" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
          {WEEKDAY_NAMES.map((name) => (
            <div key={name} role="columnheader" style={{ padding: "0.25rem", fontWeight: 600, borderBottom: "1px solid #ccc" }}>
              {name}
            </div>
          ))}
        </div>
        {grid.weeks.map((week, weekIndex) => (
          <div key={weekIndex} role="row" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
            {week.map((day) => {
              const dayIso = isoDate(day);
              const inCurrentMonth = day.getUTCMonth() === month;
              const items = itemsByDate.get(dayIso) ?? [];
              return (
                <div
                  key={dayIso}
                  role="cell"
                  data-testid={`calendar-day-${dayIso}`}
                  style={{
                    minHeight: "5rem",
                    border: "1px solid #eee",
                    padding: "0.25rem",
                    opacity: inCurrentMonth ? 1 : 0.4,
                    background: dayIso === todayIso ? "#fffbe6" : undefined,
                  }}
                >
                  <div style={{ fontSize: "0.8rem", color: "#888" }}>{day.getUTCDate()}</div>
                  {items.map((item) => (
                    <div key={item.id} data-testid={`calendar-item-${item.id}`} style={{ fontSize: "0.85rem" }}>
                      {item.name}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
