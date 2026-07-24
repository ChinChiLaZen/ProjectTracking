export type CalendarGrid = {
  // Both UTC midnight — the query range Calendar fetches against, per §8
  // ("query by date range, never load the whole board").
  gridStart: Date;
  gridEnd: Date;
  // Sun–Sat rows covering exactly the month, padded only as far as needed
  // to complete a full week at each end (4–6 rows depending on alignment,
  // not always padded to 6 — a shorter grid is a smaller query range too).
  weeks: Date[][];
};

const DAY_MS = 24 * 60 * 60 * 1000;

// `month` is 0-indexed (0 = January), matching Date.prototype.getMonth() —
// deliberate, to avoid the classic off-by-one from mixing 1-indexed UI
// months with native Date's 0-indexed ones.
export function getMonthGrid(year: number, month: number): CalendarGrid {
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const lastOfMonth = new Date(Date.UTC(year, month + 1, 0));

  const gridStart = new Date(Date.UTC(year, month, 1 - firstOfMonth.getUTCDay()));
  const gridEnd = new Date(Date.UTC(year, month, lastOfMonth.getUTCDate() + (6 - lastOfMonth.getUTCDay())));

  const weeks: Date[][] = [];
  let cursor = gridStart;
  while (cursor.getTime() <= gridEnd.getTime()) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(cursor);
      cursor = new Date(cursor.getTime() + DAY_MS);
    }
    weeks.push(week);
  }

  return { gridStart, gridEnd, weeks };
}
