import { describe, expect, it } from "vitest";
import { hasCapability, meetsMinRole, roleRank } from "./matrix";

describe("roleRank", () => {
  it("orders roles OWNER > ADMIN > MEMBER > GUEST", () => {
    expect(roleRank("OWNER")).toBeGreaterThan(roleRank("ADMIN"));
    expect(roleRank("ADMIN")).toBeGreaterThan(roleRank("MEMBER"));
    expect(roleRank("MEMBER")).toBeGreaterThan(roleRank("GUEST"));
  });
});

describe("meetsMinRole", () => {
  it("is true when role rank >= minRole rank", () => {
    expect(meetsMinRole("OWNER", "ADMIN")).toBe(true);
    expect(meetsMinRole("ADMIN", "ADMIN")).toBe(true);
  });

  it("is false when role rank < minRole rank", () => {
    expect(meetsMinRole("MEMBER", "ADMIN")).toBe(false);
    expect(meetsMinRole("GUEST", "MEMBER")).toBe(false);
  });
});

describe("hasCapability — §5 matrix", () => {
  it("only OWNER can manage org billing", () => {
    expect(hasCapability("OWNER", "org.manageBilling")).toBe(true);
    expect(hasCapability("ADMIN", "org.manageBilling")).toBe(false);
    expect(hasCapability("MEMBER", "org.manageBilling")).toBe(false);
    expect(hasCapability("GUEST", "org.manageBilling")).toBe(false);
  });

  it("OWNER and ADMIN can manage boards and edit structure", () => {
    for (const cap of ["board.manage", "board.editStructure"] as const) {
      expect(hasCapability("OWNER", cap)).toBe(true);
      expect(hasCapability("ADMIN", cap)).toBe(true);
      expect(hasCapability("MEMBER", cap)).toBe(false);
      expect(hasCapability("GUEST", cap)).toBe(false);
    }
  });

  it("every role can edit items, create personal views, and read boards", () => {
    for (const cap of ["item.edit", "view.createPersonal", "board.read"] as const) {
      expect(hasCapability("OWNER", cap)).toBe(true);
      expect(hasCapability("ADMIN", cap)).toBe(true);
      expect(hasCapability("MEMBER", cap)).toBe(true);
      expect(hasCapability("GUEST", cap)).toBe(true);
    }
  });
});
