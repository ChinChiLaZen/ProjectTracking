import { describe, expect, it } from "vitest";
import type { DeriveContext } from "./types";
import { checkboxColumn } from "./checkbox";

function ctx(value: boolean, overrides: Partial<DeriveContext<boolean, Record<string, never>>> = {}): DeriveContext<boolean, Record<string, never>> {
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

describe("checkboxColumn.valueSchema", () => {
  it("accepts true/false", () => {
    expect(checkboxColumn.valueSchema.parse(true)).toBe(true);
    expect(checkboxColumn.valueSchema.parse(false)).toBe(false);
  });

  it("rejects a non-boolean", () => {
    expect(() => checkboxColumn.valueSchema.parse("true")).toThrow();
  });
});

describe("checkboxColumn.defaultValue", () => {
  it("is false", () => {
    expect(checkboxColumn.defaultValue({})).toBe(false);
  });
});

describe("checkboxColumn.toShadow", () => {
  it("projects true to valueNumber 1", () => {
    expect(checkboxColumn.toShadow(ctx(true))).toEqual({ valueNumber: 1 });
  });

  it("projects false to valueNumber 0", () => {
    expect(checkboxColumn.toShadow(ctx(false))).toEqual({ valueNumber: 0 });
  });
});

describe("checkboxColumn.isEmpty", () => {
  it("treats unchecked as empty", () => {
    expect(checkboxColumn.isEmpty(false)).toBe(true);
    expect(checkboxColumn.isEmpty(true)).toBe(false);
  });
});

describe("checkboxColumn.groupKeys", () => {
  it("buckets into checked/unchecked", () => {
    expect(checkboxColumn.groupKeys(true, {})).toEqual([{ key: "checked", label: "Checked" }]);
    expect(checkboxColumn.groupKeys(false, {})).toEqual([{ key: "unchecked", label: "Unchecked" }]);
  });
});

describe("checkboxColumn.toDisplayString", () => {
  it("renders Yes/No", () => {
    expect(checkboxColumn.toDisplayString(true, {})).toBe("Yes");
    expect(checkboxColumn.toDisplayString(false, {})).toBe("No");
  });
});

describe("checkboxColumn.parse", () => {
  it("parses common truthy strings", () => {
    expect(checkboxColumn.parse("true", {})).toBe(true);
    expect(checkboxColumn.parse("Yes", {})).toBe(true);
    expect(checkboxColumn.parse("1", {})).toBe(true);
  });

  it("parses anything else as false", () => {
    expect(checkboxColumn.parse("no", {})).toBe(false);
    expect(checkboxColumn.parse("", {})).toBe(false);
  });
});
