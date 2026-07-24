import { describe, expect, it } from "vitest";
import { isKanbanGroupable, valueForGroupKey } from "./kanbanGroupKeyValue";

describe("isKanbanGroupable", () => {
  it("is true for status and person", () => {
    expect(isKanbanGroupable("status")).toBe(true);
    expect(isKanbanGroupable("person")).toBe(true);
  });

  it("is false for every other column type", () => {
    expect(isKanbanGroupable("text")).toBe(false);
    expect(isKanbanGroupable("long_text")).toBe(false);
    expect(isKanbanGroupable("number")).toBe(false);
    expect(isKanbanGroupable("date")).toBe(false);
    expect(isKanbanGroupable("checkbox")).toBe(false);
  });
});

describe("valueForGroupKey — status", () => {
  it("sets the value to the target bucket key", () => {
    expect(valueForGroupKey("status", "todo", "todo", "doing")).toBe("doing");
  });

  it("sets null when dropped into the empty bucket", () => {
    expect(valueForGroupKey("status", "todo", "todo", "__empty__")).toBeNull();
  });

  it("is a no-op when the target equals the source", () => {
    expect(valueForGroupKey("status", "todo", "todo", "todo")).toBe("todo");
  });
});

describe("valueForGroupKey — person", () => {
  it("removes the source assignee and adds the target", () => {
    expect(valueForGroupKey("person", ["alice"], "alice", "bob")).toEqual(["bob"]);
  });

  it("preserves other assignees untouched", () => {
    expect(valueForGroupKey("person", ["alice", "carol"], "alice", "bob")).toEqual(["carol", "bob"]);
  });

  it("dedupes if the target is already assigned", () => {
    expect(valueForGroupKey("person", ["alice", "bob"], "alice", "bob")).toEqual(["bob"]);
  });

  it("removes without adding when dropped into the empty bucket", () => {
    expect(valueForGroupKey("person", ["alice"], "alice", "__empty__")).toEqual([]);
  });

  it("adds without removing when dragged from the empty bucket", () => {
    expect(valueForGroupKey("person", [], "__empty__", "bob")).toEqual(["bob"]);
  });

  it("is a no-op when the target equals the source", () => {
    expect(valueForGroupKey("person", ["alice"], "alice", "alice")).toEqual(["alice"]);
  });
});

describe("valueForGroupKey — unsupported column type", () => {
  it("throws rather than silently writing a wrong value", () => {
    expect(() => valueForGroupKey("text", "hello", "hello", "world")).toThrow(/not Kanban-groupable/);
  });
});
