import { describe, expect, it } from "vitest";
import type { DeriveContext } from "./types";
import { timelineColumn, type TimelineValue } from "./timeline";

function ctx(value: TimelineValue, overrides: Partial<DeriveContext<TimelineValue, Record<string, never>>> = {}): DeriveContext<TimelineValue, Record<string, never>> {
  return {
    value,
    settings: {},
    item: { id: "item1", boardId: "board1", groupId: "group1" },
    valuesByColumnId: {},
    columnsById: {},
    timeZone: "UTC",
    ...overrides,
  };
}

describe("timelineColumn.valueSchema", () => {
  it("accepts a well-formed range", () => {
    expect(timelineColumn.valueSchema.parse({ start: "2026-08-01", end: "2026-08-05" })).toEqual({ start: "2026-08-01", end: "2026-08-05" });
  });

  it("accepts a single-day range (start === end)", () => {
    expect(timelineColumn.valueSchema.parse({ start: "2026-08-01", end: "2026-08-01" })).toEqual({ start: "2026-08-01", end: "2026-08-01" });
  });

  it("accepts null", () => {
    expect(timelineColumn.valueSchema.parse(null)).toBeNull();
  });

  it("rejects end before start", () => {
    expect(() => timelineColumn.valueSchema.parse({ start: "2026-08-05", end: "2026-08-01" })).toThrow();
  });

  it("rejects a non-date string", () => {
    expect(() => timelineColumn.valueSchema.parse({ start: "not-a-date", end: "2026-08-05" })).toThrow();
  });
});

describe("timelineColumn.defaultValue", () => {
  it("is null", () => {
    expect(timelineColumn.defaultValue({})).toBeNull();
  });
});

describe("timelineColumn.toShadow", () => {
  it("projects both start and end to UTC-midnight Dates", () => {
    expect(timelineColumn.toShadow(ctx({ start: "2026-08-01", end: "2026-08-05" }))).toEqual({
      valueDate: new Date("2026-08-01T00:00:00Z"),
      valueDateEnd: new Date("2026-08-05T00:00:00Z"),
    });
  });

  it("projects null to both fields null", () => {
    expect(timelineColumn.toShadow(ctx(null))).toEqual({ valueDate: null, valueDateEnd: null });
  });
});

describe("timelineColumn.isEmpty", () => {
  it("is true only for null", () => {
    expect(timelineColumn.isEmpty(null)).toBe(true);
    expect(timelineColumn.isEmpty({ start: "2026-08-01", end: "2026-08-05" })).toBe(false);
  });
});

describe("timelineColumn.groupKeys", () => {
  it("buckets by the start date", () => {
    expect(timelineColumn.groupKeys({ start: "2026-08-01", end: "2026-08-05" }, {})).toEqual([{ key: "2026-08-01", label: "2026-08-01" }]);
  });

  it("buckets null into the empty key", () => {
    expect(timelineColumn.groupKeys(null, {})).toEqual([{ key: "__empty__", label: "No value" }]);
  });
});

describe("timelineColumn.toDisplayString", () => {
  it("formats as start → end", () => {
    expect(timelineColumn.toDisplayString({ start: "2026-08-01", end: "2026-08-05" }, {})).toBe("2026-08-01 → 2026-08-05");
  });

  it("returns empty string for null", () => {
    expect(timelineColumn.toDisplayString(null, {})).toBe("");
  });
});

describe("timelineColumn.parse", () => {
  it("parses a 'start,end' pair", () => {
    expect(timelineColumn.parse("2026-08-01,2026-08-05", {})).toEqual({ start: "2026-08-01", end: "2026-08-05" });
  });

  it("returns null for end before start", () => {
    expect(timelineColumn.parse("2026-08-05,2026-08-01", {})).toBeNull();
  });

  it("returns null when not exactly two comma-separated parts", () => {
    expect(timelineColumn.parse("2026-08-01", {})).toBeNull();
  });

  it("returns null for unparseable input", () => {
    expect(timelineColumn.parse("not a range", {})).toBeNull();
  });
});
