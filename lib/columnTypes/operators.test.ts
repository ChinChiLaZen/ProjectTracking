import { describe, expect, it } from "vitest";
import { getOperator, operatorSets } from "./operators";

describe("valueText operators", () => {
  it("equals maps to an exact match", () => {
    expect(getOperator("valueText", "equals").toSql("valueText", ["hello"])).toEqual({ valueText: "hello" });
  });

  it("contains maps to a case-insensitive substring match", () => {
    expect(getOperator("valueText", "contains").toSql("valueText", ["ell"])).toEqual({
      valueText: { contains: "ell", mode: "insensitive" },
    });
  });

  it("is_empty maps to null", () => {
    expect(getOperator("valueText", "is_empty").toSql("valueText", [])).toEqual({ valueText: null });
  });
});

describe("valueNumber operators", () => {
  it("gt/lt map to comparison operators", () => {
    expect(getOperator("valueNumber", "gt").toSql("valueNumber", [5])).toEqual({ valueNumber: { gt: 5 } });
    expect(getOperator("valueNumber", "lt").toSql("valueNumber", [5])).toEqual({ valueNumber: { lt: 5 } });
  });

  it("between maps to gte/lte", () => {
    expect(getOperator("valueNumber", "between").toSql("valueNumber", [1, 10])).toEqual({
      valueNumber: { gte: 1, lte: 10 },
    });
  });
});

describe("valueDate operators", () => {
  it("before/after map to lt/gt", () => {
    const d = new Date("2026-01-01");
    expect(getOperator("valueDate", "before").toSql("valueDate", [d])).toEqual({ valueDate: { lt: d } });
    expect(getOperator("valueDate", "after").toSql("valueDate", [d])).toEqual({ valueDate: { gt: d } });
  });
});

describe("valueRefIds operators", () => {
  it("contains maps to has", () => {
    expect(getOperator("valueRefIds", "contains").toSql("valueRefIds", ["user1"])).toEqual({
      valueRefIds: { has: "user1" },
    });
  });

  it("is_empty maps to isEmpty:true (no null concept for a scalar list)", () => {
    expect(getOperator("valueRefIds", "is_empty").toSql("valueRefIds", [])).toEqual({
      valueRefIds: { isEmpty: true },
    });
  });
});

describe("getOperator", () => {
  it("throws on an unknown operator key", () => {
    expect(() => getOperator("valueText", "not_a_real_operator")).toThrow(/Unknown filter operator/);
  });

  it("finds an operator in extraOperators when not in the shared set", () => {
    const extra = [{ key: "custom", label: "Custom", arity: 1 as const, toSql: () => ({ valueText: "x" }) }];
    expect(getOperator("valueText", "custom", extra)).toBe(extra[0]);
  });
});

describe("operatorSets", () => {
  it("declares a set for every ShadowField", () => {
    expect(Object.keys(operatorSets).sort()).toEqual(["valueDate", "valueNumber", "valueRefIds", "valueText"].sort());
  });
});
