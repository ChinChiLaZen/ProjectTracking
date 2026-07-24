import { describe, expect, it } from "vitest";
import type { DeriveContext } from "./types";
import { longTextColumn } from "./long_text";

function ctx(value: string, overrides: Partial<DeriveContext<string, Record<string, never>>> = {}): DeriveContext<string, Record<string, never>> {
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

describe("longTextColumn.valueSchema", () => {
  it("accepts and trims a string", () => {
    expect(longTextColumn.valueSchema.parse("  hello world  ")).toBe("hello world");
  });

  it("accepts multi-line content", () => {
    expect(longTextColumn.valueSchema.parse("line one\nline two")).toBe("line one\nline two");
  });
});

describe("longTextColumn.toShadow", () => {
  it("projects a non-empty value to valueText", () => {
    expect(longTextColumn.toShadow(ctx("notes here"))).toEqual({ valueText: "notes here" });
  });

  it("projects an empty value to null", () => {
    expect(longTextColumn.toShadow(ctx(""))).toEqual({ valueText: null });
  });
});

describe("longTextColumn.isEmpty / groupKeys / parse", () => {
  it("isEmpty matches text's semantics", () => {
    expect(longTextColumn.isEmpty("")).toBe(true);
    expect(longTextColumn.isEmpty("x")).toBe(false);
  });

  it("groupKeys buckets empty separately", () => {
    expect(longTextColumn.groupKeys("", {})).toEqual([{ key: "__empty__", label: "No value" }]);
  });

  it("parse trims raw input", () => {
    expect(longTextColumn.parse("  hi  ", {})).toBe("hi");
  });
});
