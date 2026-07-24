import { describe, expect, it } from "vitest";
import { columnTypeRegistry } from "../columnTypes/registry";
import { viewConfigSchema } from "./viewConfig";
import { compileViewConfig } from "./compileQuery";

const columns = [
  { id: "col-name", key: "text" },
  { id: "col-notes", key: "text" },
];

describe("compileViewConfig — filters", () => {
  it("compiles a single filter into a values.some clause", () => {
    const viewConfig = viewConfigSchema.parse({
      filters: [{ columnId: "col-name", operatorKey: "contains", args: ["hello"] }],
    });

    const { itemWhere } = compileViewConfig(viewConfig, columns, columnTypeRegistry);

    expect(itemWhere).toEqual({
      AND: [{ values: { some: { columnId: "col-name", valueText: { contains: "hello", mode: "insensitive" } } } }],
    });
  });

  it("ANDs multiple filters together", () => {
    const viewConfig = viewConfigSchema.parse({
      filters: [
        { columnId: "col-name", operatorKey: "contains", args: ["hello"] },
        { columnId: "col-notes", operatorKey: "is_empty", args: [] },
      ],
    });

    const { itemWhere } = compileViewConfig(viewConfig, columns, columnTypeRegistry);

    expect(itemWhere).toEqual({
      AND: [
        { values: { some: { columnId: "col-name", valueText: { contains: "hello", mode: "insensitive" } } } },
        { values: { some: { columnId: "col-notes", valueText: null } } },
      ],
    });
  });

  it("returns an empty where when there are no filters", () => {
    const viewConfig = viewConfigSchema.parse({});
    const { itemWhere } = compileViewConfig(viewConfig, columns, columnTypeRegistry);
    expect(itemWhere).toEqual({});
  });

  it("throws when a filter references an unknown column", () => {
    const viewConfig = viewConfigSchema.parse({
      filters: [{ columnId: "does-not-exist", operatorKey: "equals", args: ["x"] }],
    });
    expect(() => compileViewConfig(viewConfig, columns, columnTypeRegistry)).toThrow(/unknown column/);
  });

  it("throws when a filter references an unknown operator", () => {
    const viewConfig = viewConfigSchema.parse({
      filters: [{ columnId: "col-name", operatorKey: "not_a_real_operator", args: [] }],
    });
    expect(() => compileViewConfig(viewConfig, columns, columnTypeRegistry)).toThrow(/Unknown filter operator/);
  });
});

describe("compileViewConfig — sort", () => {
  it("is null when no sort is set (default rank order)", () => {
    const viewConfig = viewConfigSchema.parse({});
    const { sort } = compileViewConfig(viewConfig, columns, columnTypeRegistry);
    expect(sort).toBeNull();
  });

  it("is null when sort.columnId is explicitly null", () => {
    const viewConfig = viewConfigSchema.parse({ sort: { columnId: null, direction: "asc" } });
    const { sort } = compileViewConfig(viewConfig, columns, columnTypeRegistry);
    expect(sort).toBeNull();
  });

  it("resolves a column sort to its shadow field", () => {
    const viewConfig = viewConfigSchema.parse({ sort: { columnId: "col-name", direction: "desc" } });
    const { sort } = compileViewConfig(viewConfig, columns, columnTypeRegistry);
    expect(sort).toEqual({ columnId: "col-name", shadowField: "valueText", direction: "desc" });
  });

  it("throws when the sort references an unknown column", () => {
    const viewConfig = viewConfigSchema.parse({ sort: { columnId: "does-not-exist", direction: "asc" } });
    expect(() => compileViewConfig(viewConfig, columns, columnTypeRegistry)).toThrow(/unknown column/);
  });
});
