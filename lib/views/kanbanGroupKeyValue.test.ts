import { describe, expect, it } from "vitest";
import { isKanbanGroupable, valueForGroupKey } from "./kanbanGroupKeyValue";

describe("isKanbanGroupable", () => {
  it("is true for valueText and valueRefIds", () => {
    expect(isKanbanGroupable("valueText")).toBe(true);
    expect(isKanbanGroupable("valueRefIds")).toBe(true);
  });

  it("is false for valueNumber and valueDate", () => {
    expect(isKanbanGroupable("valueNumber")).toBe(false);
    expect(isKanbanGroupable("valueDate")).toBe(false);
  });
});

describe("valueForGroupKey — valueText (status, dropdown, ...)", () => {
  it("sets the value to the target bucket key", () => {
    expect(valueForGroupKey("valueText", "todo", "todo", "doing")).toBe("doing");
  });

  it("sets null when dropped into the empty bucket", () => {
    expect(valueForGroupKey("valueText", "todo", "todo", "__empty__")).toBeNull();
  });

  it("is a no-op when the target equals the source", () => {
    expect(valueForGroupKey("valueText", "todo", "todo", "todo")).toBe("todo");
  });

  // dropdown (Session 11) is a second valueText-shadowed type — proves the
  // shadowField-based generalization actually covers it, not just status.
  it("works identically for a dropdown-shaped value (same shadow field as status)", () => {
    expect(valueForGroupKey("valueText", "opt-low", "opt-low", "opt-high")).toBe("opt-high");
  });
});

describe("valueForGroupKey — valueRefIds (person, ...)", () => {
  it("removes the source assignee and adds the target", () => {
    expect(valueForGroupKey("valueRefIds", ["alice"], "alice", "bob")).toEqual(["bob"]);
  });

  it("preserves other assignees untouched", () => {
    expect(valueForGroupKey("valueRefIds", ["alice", "carol"], "alice", "bob")).toEqual(["carol", "bob"]);
  });

  it("dedupes if the target is already assigned", () => {
    expect(valueForGroupKey("valueRefIds", ["alice", "bob"], "alice", "bob")).toEqual(["bob"]);
  });

  it("removes without adding when dropped into the empty bucket", () => {
    expect(valueForGroupKey("valueRefIds", ["alice"], "alice", "__empty__")).toEqual([]);
  });

  it("adds without removing when dragged from the empty bucket", () => {
    expect(valueForGroupKey("valueRefIds", [], "__empty__", "bob")).toEqual(["bob"]);
  });

  it("is a no-op when the target equals the source", () => {
    expect(valueForGroupKey("valueRefIds", ["alice"], "alice", "alice")).toEqual(["alice"]);
  });
});

describe("valueForGroupKey — unsupported shadow field", () => {
  it("throws rather than silently writing a wrong value", () => {
    expect(() => valueForGroupKey("valueNumber", 5, "5", "10")).toThrow(/not Kanban-groupable/);
  });
});
