import { describe, expect, it } from "vitest";
import { columnTypeRegistry } from "../columnTypes/registry";
import { getOperator } from "../columnTypes/operators";
import { deriveViewConfig, isFilterComplete, type RawFilterRow } from "./deriveDraftConfig";

const columns = [
  { id: "col-text", key: "text" },
  { id: "col-number", key: "number" },
  { id: "col-date", key: "date" },
];

function row(overrides: Partial<RawFilterRow>): RawFilterRow {
  return { id: "row1", columnId: "col-text", operatorKey: "equals", args: [], ...overrides };
}

describe("isFilterComplete", () => {
  it("arity 0 is always complete regardless of args", () => {
    const op = getOperator("valueText", "is_empty");
    expect(isFilterComplete(op, "valueText", [])).toBe(true);
    expect(isFilterComplete(op, "valueText", ["ignored"])).toBe(true);
  });

  it("arity 1 is incomplete when args are missing or blank", () => {
    const op = getOperator("valueText", "equals");
    expect(isFilterComplete(op, "valueText", [])).toBe(false);
    expect(isFilterComplete(op, "valueText", [""])).toBe(false);
    expect(isFilterComplete(op, "valueText", ["  "])).toBe(false);
  });

  it("arity 1 is complete with a non-blank text arg", () => {
    const op = getOperator("valueText", "equals");
    expect(isFilterComplete(op, "valueText", ["hello"])).toBe(true);
  });

  it("arity 1 number op rejects unparseable input", () => {
    const op = getOperator("valueNumber", "gt");
    expect(isFilterComplete(op, "valueNumber", ["not-a-number"])).toBe(false);
    expect(isFilterComplete(op, "valueNumber", ["5"])).toBe(true);
  });

  it("arity 2 (between) needs both args complete", () => {
    const op = getOperator("valueNumber", "between");
    expect(isFilterComplete(op, "valueNumber", ["1"])).toBe(false);
    expect(isFilterComplete(op, "valueNumber", ["1", ""])).toBe(false);
    expect(isFilterComplete(op, "valueNumber", ["1", "10"])).toBe(true);
  });
});

describe("deriveViewConfig", () => {
  it("includes complete filter rows, converting number args", () => {
    const rows: RawFilterRow[] = [row({ columnId: "col-number", operatorKey: "gt", args: ["5"] })];
    const config = deriveViewConfig(rows, null, columns, columnTypeRegistry);
    expect(config.filters).toEqual([{ columnId: "col-number", operatorKey: "gt", args: [5] }]);
  });

  it("drops incomplete rows", () => {
    const rows: RawFilterRow[] = [row({ columnId: "col-text", operatorKey: "equals", args: [""] })];
    const config = deriveViewConfig(rows, null, columns, columnTypeRegistry);
    expect(config.filters).toEqual([]);
  });

  it("drops rows referencing an unknown column rather than throwing", () => {
    const rows: RawFilterRow[] = [row({ columnId: "does-not-exist", operatorKey: "equals", args: ["x"] })];
    expect(() => deriveViewConfig(rows, null, columns, columnTypeRegistry)).not.toThrow();
    expect(deriveViewConfig(rows, null, columns, columnTypeRegistry).filters).toEqual([]);
  });

  it("drops rows with an unknown operator key rather than throwing", () => {
    const rows: RawFilterRow[] = [row({ columnId: "col-text", operatorKey: "not-a-real-operator", args: ["x"] })];
    expect(() => deriveViewConfig(rows, null, columns, columnTypeRegistry)).not.toThrow();
    expect(deriveViewConfig(rows, null, columns, columnTypeRegistry).filters).toEqual([]);
  });

  it("keeps a complete arity-0 row with no args", () => {
    const rows: RawFilterRow[] = [row({ columnId: "col-text", operatorKey: "is_empty", args: [] })];
    const config = deriveViewConfig(rows, null, columns, columnTypeRegistry);
    expect(config.filters).toEqual([{ columnId: "col-text", operatorKey: "is_empty", args: [] }]);
  });

  it("keeps date args as raw strings", () => {
    const rows: RawFilterRow[] = [row({ columnId: "col-date", operatorKey: "after", args: ["2026-01-01"] })];
    const config = deriveViewConfig(rows, null, columns, columnTypeRegistry);
    expect(config.filters).toEqual([{ columnId: "col-date", operatorKey: "after", args: ["2026-01-01"] }]);
  });

  it("derives a manual sort as null", () => {
    const config = deriveViewConfig([], null, columns, columnTypeRegistry);
    expect(config.sort).toBeNull();
  });

  it("derives a column sort when the column exists", () => {
    const config = deriveViewConfig([], { columnId: "col-number", direction: "desc" }, columns, columnTypeRegistry);
    expect(config.sort).toEqual({ columnId: "col-number", direction: "desc" });
  });

  it("drops a sort referencing an unknown column", () => {
    const config = deriveViewConfig([], { columnId: "does-not-exist", direction: "asc" }, columns, columnTypeRegistry);
    expect(config.sort).toBeNull();
  });
});
