import { describe, expect, it } from "vitest";
import { getMonthGrid } from "./calendarGrid";

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

describe("getMonthGrid", () => {
  it("needs no padding when the month starts on Sunday and ends on Saturday (Feb 2026)", () => {
    const grid = getMonthGrid(2026, 1); // February, 0-indexed month
    expect(iso(grid.gridStart)).toBe("2026-02-01");
    expect(iso(grid.gridEnd)).toBe("2026-02-28");
    expect(grid.weeks).toHaveLength(4);
  });

  it("pads both ends for a mid-week-aligned leap-year February (Feb 2028)", () => {
    const grid = getMonthGrid(2028, 1);
    expect(iso(grid.gridStart)).toBe("2028-01-30");
    expect(iso(grid.gridEnd)).toBe("2028-03-04");
    expect(grid.weeks).toHaveLength(5);
  });

  it("needs a full 6-week grid when alignment is unfavorable at both ends (Jan 2000)", () => {
    const grid = getMonthGrid(2000, 0);
    expect(iso(grid.gridStart)).toBe("1999-12-26");
    expect(iso(grid.gridEnd)).toBe("2000-02-05");
    expect(grid.weeks).toHaveLength(6);
  });

  it("rolls over the year correctly (Dec 2026 -> Jan 2027)", () => {
    const grid = getMonthGrid(2026, 11);
    expect(iso(grid.gridStart)).toBe("2026-11-29");
    expect(iso(grid.gridEnd)).toBe("2027-01-02");
    expect(grid.weeks).toHaveLength(5);
  });

  it("every week has exactly 7 consecutive days, starting on Sunday and ending on Saturday", () => {
    const grid = getMonthGrid(2026, 1);
    for (const week of grid.weeks) {
      expect(week).toHaveLength(7);
      expect(week[0]!.getUTCDay()).toBe(0);
      expect(week[6]!.getUTCDay()).toBe(6);
      for (let i = 1; i < week.length; i++) {
        expect(week[i]!.getTime() - week[i - 1]!.getTime()).toBe(24 * 60 * 60 * 1000);
      }
    }
  });

  it("the grid fully contains every day of the month", () => {
    const grid = getMonthGrid(2026, 1);
    const allDays = grid.weeks.flat().map(iso);
    for (let day = 1; day <= 28; day++) {
      expect(allDays).toContain(`2026-02-${String(day).padStart(2, "0")}`);
    }
  });
});
