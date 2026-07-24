import { describe, expect, it } from "vitest";
import type { DeriveContext } from "./types";
import { textColumn } from "./text";

function ctx(
  value: string,
  overrides: Partial<DeriveContext<string, Record<string, never>>> = {},
): DeriveContext<string, Record<string, never>> {
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

describe("textColumn.valueSchema", () => {
  it("accepts a plain string", () => {
    expect(textColumn.valueSchema.parse("hello")).toBe("hello");
  });

  it("trims whitespace", () => {
    expect(textColumn.valueSchema.parse("  hello  ")).toBe("hello");
  });

  it("accepts an empty string", () => {
    expect(textColumn.valueSchema.parse("")).toBe("");
  });

  it("rejects a non-string value", () => {
    expect(() => textColumn.valueSchema.parse(42)).toThrow();
  });
});

describe("textColumn.settingsSchema", () => {
  it("accepts an empty object", () => {
    expect(textColumn.settingsSchema.parse({})).toEqual({});
  });
});

describe("textColumn.defaultValue", () => {
  it("is an empty string regardless of settings", () => {
    expect(textColumn.defaultValue({})).toBe("");
  });
});

describe("textColumn.shadowField", () => {
  it("is valueText", () => {
    expect(textColumn.shadowField).toBe("valueText");
  });
});

describe("textColumn.toShadow", () => {
  it("projects a non-empty value to valueText", () => {
    expect(textColumn.toShadow(ctx("hello"))).toEqual({ valueText: "hello" });
  });

  it("projects an empty value to null", () => {
    expect(textColumn.toShadow(ctx(""))).toEqual({ valueText: null });
  });

  it("ignores sibling column values and timezone", () => {
    const withSiblings = ctx("hello", {
      valuesByColumnId: { other: "irrelevant" },
      columnsById: { other: { id: "other", type: "number", settings: {} } },
      timeZone: "America/Los_Angeles",
    });
    expect(textColumn.toShadow(withSiblings)).toEqual({ valueText: "hello" });
  });
});

describe("textColumn.isEmpty", () => {
  it("is true for an empty string", () => {
    expect(textColumn.isEmpty("")).toBe(true);
  });

  it("is false for a non-empty string", () => {
    expect(textColumn.isEmpty("hello")).toBe(false);
  });
});

describe("textColumn.groupKeys", () => {
  it("buckets an empty value into an explicit 'no value' key", () => {
    expect(textColumn.groupKeys("", {})).toEqual([{ key: "__empty__", label: "No value" }]);
  });

  it("buckets a non-empty value by its own text", () => {
    expect(textColumn.groupKeys("hello", {})).toEqual([{ key: "hello", label: "hello" }]);
  });
});

describe("textColumn.toDisplayString", () => {
  it("returns the raw value", () => {
    expect(textColumn.toDisplayString("hello", {})).toBe("hello");
  });
});

describe("textColumn.parse", () => {
  it("trims raw input", () => {
    expect(textColumn.parse("  hello  ", {})).toBe("hello");
  });

  it("never fails to parse — always returns a string", () => {
    expect(textColumn.parse("", {})).toBe("");
  });
});
