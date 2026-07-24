import { describe, expect, it } from "vitest";
import type { DeriveContext } from "./types";
import { personColumn } from "./person";

function ctx(value: string[], overrides: Partial<DeriveContext<string[], { allowMultiple: boolean }>> = {}): DeriveContext<string[], { allowMultiple: boolean }> {
  return {
    value,
    settings: { allowMultiple: true },
    item: { id: "item1", boardId: "board1", groupId: "group1" },
    valuesByColumnId: {},
    columnsById: {},
    timeZone: "UTC",
    ...overrides,
  };
}

describe("personColumn.valueSchema", () => {
  it("accepts an array of user ids", () => {
    expect(personColumn.valueSchema.parse(["user1", "user2"])).toEqual(["user1", "user2"]);
  });

  it("accepts an empty array", () => {
    expect(personColumn.valueSchema.parse([])).toEqual([]);
  });
});

describe("personColumn.settingsSchema", () => {
  it("defaults allowMultiple to true", () => {
    expect(personColumn.settingsSchema.parse({})).toEqual({ allowMultiple: true });
  });
});

describe("personColumn.defaultValue", () => {
  it("is an empty array, not null", () => {
    expect(personColumn.defaultValue({ allowMultiple: true })).toEqual([]);
  });
});

describe("personColumn.toShadow", () => {
  it("projects assignees to valueRefIds", () => {
    expect(personColumn.toShadow(ctx(["user1", "user2"]))).toEqual({ valueRefIds: ["user1", "user2"] });
  });

  it("projects no assignees to an empty valueRefIds", () => {
    expect(personColumn.toShadow(ctx([]))).toEqual({ valueRefIds: [] });
  });
});

describe("personColumn.isEmpty", () => {
  it("is true when no assignees", () => {
    expect(personColumn.isEmpty([])).toBe(true);
    expect(personColumn.isEmpty(["user1"])).toBe(false);
  });
});

describe("personColumn.groupKeys", () => {
  it("puts a multi-assignee item in one bucket per assignee", () => {
    expect(personColumn.groupKeys(["user1", "user2"], { allowMultiple: true })).toEqual([
      { key: "user1", label: "user1" },
      { key: "user2", label: "user2" },
    ]);
  });

  it("buckets no assignees into the empty key", () => {
    expect(personColumn.groupKeys([], { allowMultiple: true })).toEqual([{ key: "__empty__", label: "No value" }]);
  });
});

describe("personColumn.parse", () => {
  it("splits a comma-separated list of ids", () => {
    expect(personColumn.parse("user1, user2,user3", { allowMultiple: true })).toEqual(["user1", "user2", "user3"]);
  });

  it("returns an empty array for empty input", () => {
    expect(personColumn.parse("", { allowMultiple: true })).toEqual([]);
  });
});
