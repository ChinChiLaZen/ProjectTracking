import { describe, expect, it } from "vitest";
import type { DeriveContext } from "./types";
import { statusColumn } from "./status";

const options = [
  { id: "opt-todo", label: "To Do", color: "#ccc", order: 0 },
  { id: "opt-doing", label: "In Progress", color: "#fc0", order: 1 },
  { id: "opt-done", label: "Done", color: "#0c0", order: 2 },
];
const settings = { options };

function ctx(value: string | null, overrides: Partial<DeriveContext<string | null, typeof settings>> = {}): DeriveContext<string | null, typeof settings> {
  return {
    value,
    settings,
    item: { id: "item1", boardId: "board1", groupId: "group1" },
    valuesByColumnId: {},
    columnsById: {},
    timeZone: "UTC",
    ...overrides,
  };
}

describe("statusColumn.valueSchema", () => {
  it("accepts an optionId string", () => {
    expect(statusColumn.valueSchema.parse("opt-todo")).toBe("opt-todo");
  });

  it("accepts null (unset)", () => {
    expect(statusColumn.valueSchema.parse(null)).toBeNull();
  });
});

describe("statusColumn.settingsSchema", () => {
  it("accepts a well-formed option set", () => {
    expect(statusColumn.settingsSchema.parse(settings)).toEqual(settings);
  });

  it("defaults options to an empty array", () => {
    expect(statusColumn.settingsSchema.parse({})).toEqual({ options: [] });
  });
});

describe("statusColumn.toShadow", () => {
  it("projects the raw optionId to valueText", () => {
    expect(statusColumn.toShadow(ctx("opt-doing"))).toEqual({ valueText: "opt-doing" });
  });

  it("projects null to null", () => {
    expect(statusColumn.toShadow(ctx(null))).toEqual({ valueText: null });
  });
});

describe("statusColumn.isEmpty", () => {
  it("is true only for null", () => {
    expect(statusColumn.isEmpty(null)).toBe(true);
    expect(statusColumn.isEmpty("opt-todo")).toBe(false);
  });
});

describe("statusColumn.groupKeys", () => {
  it("buckets by optionId, carrying the option's label and color", () => {
    expect(statusColumn.groupKeys("opt-doing", settings)).toEqual([
      { key: "opt-doing", label: "In Progress", color: "#fc0" },
    ]);
  });

  it("buckets null into the empty key", () => {
    expect(statusColumn.groupKeys(null, settings)).toEqual([{ key: "__empty__", label: "No value" }]);
  });

  it("falls back to the raw id if the option was deleted from settings", () => {
    expect(statusColumn.groupKeys("opt-gone", settings)).toEqual([{ key: "opt-gone", label: "opt-gone", color: undefined }]);
  });
});

describe("statusColumn.toDisplayString", () => {
  it("resolves the option's label", () => {
    expect(statusColumn.toDisplayString("opt-done", settings)).toBe("Done");
  });

  it("returns empty string for null", () => {
    expect(statusColumn.toDisplayString(null, settings)).toBe("");
  });

  it("returns empty string for a deleted option (not the raw id)", () => {
    expect(statusColumn.toDisplayString("opt-gone", settings)).toBe("");
  });
});

describe("statusColumn.parse", () => {
  it("resolves a label (case-insensitive) to its optionId", () => {
    expect(statusColumn.parse("in progress", settings)).toBe("opt-doing");
  });

  it("returns null for an unmatched label", () => {
    expect(statusColumn.parse("Blocked", settings)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(statusColumn.parse("", settings)).toBeNull();
  });
});
