import { generateKeyBetween } from "fractional-indexing";

// Fractional rank helpers (§4.2). Session 2 only needed append-at-end
// (firstRank/rankAfter); Session 3 adds the general "insert between two
// arbitrary neighbors" case that drag-to-reorder needs, and both existing
// callers now sit on top of it unchanged.

const RANK_WARN_LENGTH = 40;

/**
 * `before`/`after` are the ranks of the items the new one should land
 * between; either may be null to mean "no bound on that side."
 */
export function rankBetween(before: string | null, after: string | null): string {
  const rank = generateKeyBetween(before, after);

  // §13 risk: alert if rank precision is blowing out under heavy
  // reordering, so `rebalanceRanks` gets run before it becomes a real
  // problem. Centralized here rather than duplicated at every call site.
  // Expected to be rare — not worth suppressing repeats.
  if (rank.length > RANK_WARN_LENGTH) {
    console.warn(
      `[lib/ordering] rank "${rank}" exceeds ${RANK_WARN_LENGTH} chars — consider running rebalanceRanks for this scope.`,
    );
  }

  return rank;
}

export function firstRank(): string {
  return rankBetween(null, null);
}

export function rankAfter(rank: string): string {
  return rankBetween(rank, null);
}

// A malformed rank isn't just a cosmetic misordering — fractional-indexing
// validates its inputs strictly, so a bad stored rank crashes the *next*
// rankBetween/rankAfter call against it (e.g. inserting a new sibling).
// Callers that persist a client-supplied rank (moveItem/moveGroup) must
// check this before writing. No public validator is exported by the
// library, so this probes the same validation `generateKeyBetween` does.
export function isValidRank(rank: string): boolean {
  try {
    generateKeyBetween(rank, null);
    return true;
  } catch {
    return false;
  }
}
