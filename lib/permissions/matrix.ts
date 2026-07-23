export type Role = "OWNER" | "ADMIN" | "MEMBER" | "GUEST";

export type Capability =
  | "org.manageBilling"
  | "board.manage" // create/delete boards, manage board members
  | "board.editStructure" // columns, automations, shared views
  | "item.edit" // create/edit/move items, comment
  | "view.createPersonal"
  | "board.read";

const ROLE_RANK: Record<Role, number> = {
  GUEST: 1,
  MEMBER: 2,
  ADMIN: 3,
  OWNER: 4,
};

// §5 capability table.
const CAPABILITY_MIN_ROLE: Record<Capability, Role> = {
  "org.manageBilling": "OWNER",
  "board.manage": "ADMIN",
  "board.editStructure": "ADMIN",
  "item.edit": "GUEST",
  "view.createPersonal": "GUEST",
  "board.read": "GUEST",
};

export function roleRank(role: Role): number {
  return ROLE_RANK[role];
}

export function meetsMinRole(role: Role, minRole: Role): boolean {
  return roleRank(role) >= roleRank(minRole);
}

export function hasCapability(role: Role, capability: Capability): boolean {
  return meetsMinRole(role, CAPABILITY_MIN_ROLE[capability]);
}
