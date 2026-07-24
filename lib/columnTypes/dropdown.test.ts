import { describe, expect, it } from "vitest";
import type { DeriveContext } from "./types";
import { dropdownColumn } from "./dropdown";

const options = [
  { id: "opt-low", label: "Low", order: 0 },
  { id: "opt-medium", label: "Medium", order: 1 },
  { id: "opt-high", label: "High", color: "#c00", order: 2 },
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

describe("dropdownColumn.valueSchema", () => {
  it("accepts an optionId string", () => {
    expect(dropdownColumn.valueSchema.parse("opt-low")).toBe("opt-low");
  });

  it("accepts null (unset)", () => {
    expect(dropdownColumn.valueSchema.parse(null)).toBeNull();
  });
});

describe("dropdownColumn.settingsSchema", () => {
  it("accepts a well-formed option set, color optional", () => {
    expect(dropdownColumn.settingsSchema.parse(settings)).toEqual(settings);
  });

  it("defaults options to an empty array", () => {
    expect(dropdownColumn.settingsSchema.parse({})).toEqual({ options: [] });
  });
});

describe("dropdownColumn.toShadow", () => {
  it("projects the raw optionId to valueText", () => {
    expect(dropdownColumn.toShadow(ctx("opt-medium"))).toEqual({ valueText: "opt-medium" });
  });

  it("projects null to null", () => {
    expect(dropdownColumn.toShadow(ctx(null))).toEqual({ valueText: null });
  });
});

describe("dropdownColumn.isEmpty", () => {
  it("is true only for null", () => {
    expect(dropdownColumn.isEmpty(null)).toBe(true);
    expect(dropdownColumn.isEmpty("opt-low")).toBe(false);
  });
});

describe("dropdownColumn.groupKeys", () => {
  it("buckets by optionId, carrying the option's label and color", () => {
    expect(dropdownColumn.groupKeys("opt-high", settings)).toEqual([{ key: "opt-high", label: "High", color: "#c00" }]);
  });

  it("buckets null into the empty key", () => {
    expect(dropdownColumn.groupKeys(null, settings)).toEqual([{ key: "__empty__", label: "No value" }]);
  });

  it("falls back to the raw id if the option was deleted from settings", () => {
    expect(dropdownColumn.groupKeys("opt-gone", settings)).toEqual([{ key: "opt-gone", label: "opt-gone", color: undefined }]);
  });
});

describe("dropdownColumn.toDisplayString", () => {
  it("resolves the option's label", () => {
    expect(dropdownColumn.toDisplayString("opt-medium", settings)).toBe("Medium");
  });

  it("returns empty string for null", () => {
    expect(dropdownColumn.toDisplayString(null, settings)).toBe("");
  });

  it("returns empty string for a deleted option (not the raw id)", () => {
    expect(dropdownColumn.toDisplayString("opt-gone", settings)).toBe("");
  });
});

describe("dropdownColumn.parse", () => {
  it("resolves a label (case-insensitive) to its optionId", () => {
    expect(dropdownColumn.parse("high", settings)).toBe("opt-high");
  });

  it("returns null for an unmatched label", () => {
    expect(dropdownColumn.parse("Urgent", settings)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(dropdownColumn.parse("", settings)).toBeNull();
  });
});
