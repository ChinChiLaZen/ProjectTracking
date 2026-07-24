import { generateKeyBetween } from "fractional-indexing";

// Minimal rank generation for Session 2 inserts (§4.2). The full lib/ordering/
// module — rebalanceRanks job, drag-to-reorder helpers — is Session 3's job;
// this file is deliberately small so Session 3 extends it rather than
// creating it from scratch.

export function firstRank(): string {
  return generateKeyBetween(null, null);
}

export function rankAfter(rank: string): string {
  return generateKeyBetween(rank, null);
}
