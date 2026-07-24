import { describe, expect, it } from "vitest";
import type { DeriveContext } from "./types";
import { numberColumn } from "./number";

function ctx(value: number | null, overrides: Partial<DeriveContext<number | null, Record<string, never>>> = {}): DeriveContext<number | null, Record<string, never>> {
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

describe("numberColumn.valueSchema", () => {
  it("accepts a number", () => {
    expect(numberColumn.valueSchema.parse(42)).toBe(42);
  });

  it("accepts null", () => {
    expect(numberColumn.valueSchema.parse(null)).toBeNull();
  });

  it("rejects a string", () => {
    expect(() => numberColumn.valueSchema.parse("42")).toThrow();
  });
});

describe("numberColumn.defaultValue", () => {
  it("is null, not 0", () => {
    expect(numberColumn.defaultValue({})).toBeNull();
  });
});

describe("numberColumn.toShadow", () => {
  it("projects a number to valueNumber", () => {
    expect(numberColumn.toShadow(ctx(42))).toEqual({ valueNumber: 42 });
  });

  it("projects 0 to valueNumber 0, not null", () => {
    expect(numberColumn.toShadow(ctx(0))).toEqual({ valueNumber: 0 });
  });

  it("projects null to valueNumber null", () => {
    expect(numberColumn.toShadow(ctx(null))).toEqual({ valueNumber: null });
  });
});

describe("numberColumn.isEmpty", () => {
  it("is true only for null, not for 0", () => {
    expect(numberColumn.isEmpty(null)).toBe(true);
    expect(numberColumn.isEmpty(0)).toBe(false);
  });
});

describe("numberColumn.groupKeys", () => {
  it("buckets null into the empty key", () => {
    expect(numberColumn.groupKeys(null, {})).toEqual([{ key: "__empty__", label: "No value" }]);
  });

  it("buckets a number by its string form", () => {
    expect(numberColumn.groupKeys(42, {})).toEqual([{ key: "42", label: "42" }]);
  });
});

describe("numberColumn.toDisplayString", () => {
  it("returns empty string for null", () => {
    expect(numberColumn.toDisplayString(null, {})).toBe("");
  });

  it("stringifies a number", () => {
    expect(numberColumn.toDisplayString(42, {})).toBe("42");
  });
});

describe("numberColumn.parse", () => {
  it("parses a numeric string", () => {
    expect(numberColumn.parse("42", {})).toBe(42);
  });

  it("returns null for empty input", () => {
    expect(numberColumn.parse("", {})).toBeNull();
  });

  it("returns null for unparseable input", () => {
    expect(numberColumn.parse("not a number", {})).toBeNull();
  });
});
