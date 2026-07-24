import { prisma } from "../db/client";
import { runWithTenant } from "../db/tenantContext";
import type { Role } from "../../lib/permissions/matrix";

export type BoardMember = {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
  role: Role;
};

// Replicates requireBoardAccess's per-user precedence (lib/permissions/
// requireBoardAccess.ts) across every org member at once: an explicit
// BoardMembership role wins; otherwise the org-level Membership role
// applies, unless it's GUEST (guests get no default board access — only
// an explicit BoardMembership grants them anything). Used by @mention
// autocomplete/validation (Session 14) and gated the same "GUEST" board.read
// baseline as item.list/view.list — any board member, including an
// assigned guest, can see who else is on the board to mention.
export async function listBoardMembers(params: { organizationId: string; boardId: string }): Promise<BoardMember[]> {
  const { organizationId, boardId } = params;

  return runWithTenant(organizationId, async () => {
    // BoardMembership carries no organizationId column (and isn't in the
    // tenant-scoping extension's model set — server/db/client.ts), so it
    // can't be filtered by tenant directly. Confirm the board itself
    // belongs to this org first (same defense-in-depth board.findFirst
    // requireBoardAccess already does) — cross-org returns empty, not a
    // leak, matching every other list query's precedent.
    const board = await prisma.board.findFirst({ where: { id: boardId, organizationId } });
    if (!board) return [];

    const [boardMemberships, orgMemberships] = await Promise.all([
      prisma.boardMembership.findMany({
        where: { boardId },
        include: { user: true },
      }),
      prisma.membership.findMany({
        where: { organizationId },
        include: { user: true },
      }),
    ]);

    const byUserId = new Map<string, BoardMember>();

    for (const m of orgMemberships) {
      if (m.role === "GUEST") continue; // no default board access
      byUserId.set(m.userId, {
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        image: m.user.image,
        role: m.role as Role,
      });
    }

    for (const m of boardMemberships) {
      // Explicit board membership always overrides the org-level default.
      byUserId.set(m.userId, {
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        image: m.user.image,
        role: m.role as Role,
      });
    }

    return Array.from(byUserId.values()).sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
  });
}
