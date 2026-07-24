import { describe, expect, it } from "vitest";
import type { DeriveContext } from "./types";
import { dateColumn } from "./date";

function ctx(value: string | null, overrides: Partial<DeriveContext<string | null, Record<string, never>>> = {}): DeriveContext<string | null, Record<string, never>> {
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

describe("dateColumn.valueSchema", () => {
  it("accepts an ISO date string", () => {
    expect(dateColumn.valueSchema.parse("2026-01-15")).toBe("2026-01-15");
  });

  it("accepts null", () => {
    expect(dateColumn.valueSchema.parse(null)).toBeNull();
  });

  it("rejects a non-date string", () => {
    expect(() => dateColumn.valueSchema.parse("not-a-date")).toThrow();
  });

  it("rejects an out-of-range date", () => {
    expect(() => dateColumn.valueSchema.parse("2026-13-40")).toThrow();
  });
});

describe("dateColumn.defaultValue", () => {
  it("is null", () => {
    expect(dateColumn.defaultValue({})).toBeNull();
  });
});

describe("dateColumn.toShadow", () => {
  it("projects a date string to a UTC-midnight Date", () => {
    expect(dateColumn.toShadow(ctx("2026-01-15"))).toEqual({ valueDate: new Date("2026-01-15T00:00:00Z") });
  });

  it("projects null to null", () => {
    expect(dateColumn.toShadow(ctx(null))).toEqual({ valueDate: null });
  });

  it("ignores the board timezone (known Session 5 simplification)", () => {
    const withTz = ctx("2026-01-15", { timeZone: "America/Los_Angeles" });
    expect(dateColumn.toShadow(withTz)).toEqual({ valueDate: new Date("2026-01-15T00:00:00Z") });
  });
});

describe("dateColumn.isEmpty", () => {
  it("is true only for null", () => {
    expect(dateColumn.isEmpty(null)).toBe(true);
    expect(dateColumn.isEmpty("2026-01-15")).toBe(false);
  });
});

describe("dateColumn.groupKeys", () => {
  it("buckets null into the empty key", () => {
    expect(dateColumn.groupKeys(null, {})).toEqual([{ key: "__empty__", label: "No value" }]);
  });

  it("buckets a date by its ISO string", () => {
    expect(dateColumn.groupKeys("2026-01-15", {})).toEqual([{ key: "2026-01-15", label: "2026-01-15" }]);
  });
});

describe("dateColumn.parse", () => {
  it("accepts a valid date string", () => {
    expect(dateColumn.parse("2026-01-15", {})).toBe("2026-01-15");
  });

  it("returns null for empty input", () => {
    expect(dateColumn.parse("", {})).toBeNull();
  });

  it("returns null for unparseable input", () => {
    expect(dateColumn.parse("not a date", {})).toBeNull();
  });
});
