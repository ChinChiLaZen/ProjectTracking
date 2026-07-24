import { describe, expect, it } from "vitest";
import { statusColumn } from "../columnTypes/status";
import { personColumn } from "../columnTypes/person";
import { dropdownColumn } from "../columnTypes/dropdown";
import { bucketItemsByGroupKeys } from "./bucketItemsByGroupKeys";

const statusSettings = {
  options: [
    { id: "done", label: "Done", color: "#0c0", order: 2 },
    { id: "todo", label: "To Do", color: "#ccc", order: 0 },
    { id: "doing", label: "In Progress", color: "#fc0", order: 1 },
    { id: "blocked", label: "Blocked", color: "#c00", order: 3 },
  ],
};

describe("bucketItemsByGroupKeys — status", () => {
  it("enumerates every configured option in configured order, even with zero items", () => {
    const items = [{ id: "i1" }];
    const values: Record<string, unknown> = { i1: "todo" };
    const buckets = bucketItemsByGroupKeys(items, (id) => values[id], statusColumn, statusSettings);

    expect(buckets.map((b) => b.key)).toEqual(["todo", "doing", "done", "blocked", "__empty__"]);
    expect(buckets.find((b) => b.key === "blocked")?.itemIds).toEqual([]);
    expect(buckets.find((b) => b.key === "todo")?.itemIds).toEqual(["i1"]);
  });

  it("buckets an item with no value into the empty bucket", () => {
    const items = [{ id: "i1" }];
    const buckets = bucketItemsByGroupKeys(items, () => undefined, statusColumn, statusSettings);
    expect(buckets.find((b) => b.key === "__empty__")?.itemIds).toEqual(["i1"]);
  });

  it("places every item into its own bucket, one item per key", () => {
    const items = [{ id: "i1" }, { id: "i2" }, { id: "i3" }];
    const values: Record<string, unknown> = { i1: "todo", i2: "todo", i3: "doing" };
    const buckets = bucketItemsByGroupKeys(items, (id) => values[id], statusColumn, statusSettings);
    expect(buckets.find((b) => b.key === "todo")?.itemIds).toEqual(["i1", "i2"]);
    expect(buckets.find((b) => b.key === "doing")?.itemIds).toEqual(["i3"]);
  });
});

describe("bucketItemsByGroupKeys — dropdown", () => {
  it("enumerates every configured option in configured order too, same as status", () => {
    const dropdownSettings = {
      options: [
        { id: "opt-high", label: "High", order: 2 },
        { id: "opt-low", label: "Low", order: 0 },
        { id: "opt-medium", label: "Medium", order: 1 },
      ],
    };
    const items = [{ id: "i1" }];
    const values: Record<string, unknown> = { i1: "opt-low" };
    const buckets = bucketItemsByGroupKeys(items, (id) => values[id], dropdownColumn, dropdownSettings);

    expect(buckets.map((b) => b.key)).toEqual(["opt-low", "opt-medium", "opt-high", "__empty__"]);
    expect(buckets.find((b) => b.key === "opt-high")?.itemIds).toEqual([]);
    expect(buckets.find((b) => b.key === "opt-low")?.itemIds).toEqual(["i1"]);
  });
});

describe("bucketItemsByGroupKeys — person", () => {
  it("only buckets observed values, in first-seen order (no board-membership enumeration)", () => {
    const items = [{ id: "i1" }, { id: "i2" }];
    const values: Record<string, unknown> = { i1: ["bob"], i2: ["alice"] };
    const buckets = bucketItemsByGroupKeys(items, (id) => values[id], personColumn, { allowMultiple: true });
    expect(buckets.map((b) => b.key)).toEqual(["bob", "alice"]);
  });

  it("puts a multi-assignee item into every one of its buckets (Decision 3)", () => {
    const items = [{ id: "i1" }];
    const values: Record<string, unknown> = { i1: ["alice", "bob"] };
    const buckets = bucketItemsByGroupKeys(items, (id) => values[id], personColumn, { allowMultiple: true });
    expect(buckets.map((b) => b.key).sort()).toEqual(["alice", "bob"]);
    expect(buckets.every((b) => b.itemIds.includes("i1"))).toBe(true);
  });

  it("buckets an unassigned item into the empty bucket", () => {
    const items = [{ id: "i1" }];
    const values: Record<string, unknown> = { i1: [] };
    const buckets = bucketItemsByGroupKeys(items, (id) => values[id], personColumn, { allowMultiple: true });
    expect(buckets).toEqual([{ key: "__empty__", label: "No value", itemIds: ["i1"] }]);
  });
});
