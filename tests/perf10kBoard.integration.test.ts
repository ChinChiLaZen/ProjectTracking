import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../server/db/client";
import { getBoardShell } from "../server/services/boards";
import { listItemsInGroup } from "../server/services/items";
import { viewConfigSchema, defaultViewConfig } from "../lib/views/viewConfig";

// §8 performance budgets, checked against the seeded "10k Items" board
// (pnpm db:seed — bulk-inserted, see prisma/seed.ts's seedBigBoard).
//
// IMPORTANT CAVEAT: this times the server-side Prisma query only, via
// performance.now(). It is a proxy for query cost, not a real end-user p75
// measurement — no browser/Lighthouse profiling is available in this
// environment, so network latency and client render time aren't included.
// Thresholds are set generously (well above the §8 numbers) to absorb that
// gap and avoid CI flakiness, not to claim the budget is met end-to-end.
describe("10k-item board performance (§8, proxy measurement)", () => {
  let organizationId: string;
  let boardId: string;
  let groupId: string;
  let titleColumnId: string;

  beforeAll(async () => {
    const board = await prisma.board.findFirst({ where: { name: "10k Items" } });
    if (!board) {
      throw new Error('Seeded "10k Items" board not found — run `pnpm db:seed` before this test.');
    }
    organizationId = board.organizationId;
    boardId = board.id;

    const group = await prisma.group.findFirstOrThrow({ where: { boardId } });
    groupId = group.id;

    const column = await prisma.columnDefinition.findFirstOrThrow({ where: { boardId, name: "Title" } });
    titleColumnId = column.id;
  });

  it("board shell (metadata + groups + columns, no items) is fast", async () => {
    const start = performance.now();
    const shell = await getBoardShell(organizationId, boardId);
    const elapsedMs = performance.now() - start;

    expect(shell.groups.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(500);
  });

  it("first page of 50 items (unfiltered, default rank order) meets a generous first-paint proxy", async () => {
    const start = performance.now();
    const page = await listItemsInGroup({
      organizationId,
      boardId,
      groupId,
      viewConfig: defaultViewConfig,
      limit: 50,
    });
    const elapsedMs = performance.now() - start;

    expect(page.items).toHaveLength(50);
    // §8: "Board first paint (50 items) < 1.0s p75" — this is the query
    // component of that, not the full client paint.
    expect(elapsedMs).toBeLessThan(1000);
  });

  it("filtered + sorted re-query meets a generous proxy for the §8 500ms budget", async () => {
    const viewConfig = viewConfigSchema.parse({
      filters: [{ columnId: titleColumnId, operatorKey: "contains", args: ["Item"] }],
      sort: { columnId: titleColumnId, direction: "desc" },
    });

    const start = performance.now();
    const page = await listItemsInGroup({ organizationId, boardId, groupId, viewConfig, limit: 50 });
    const elapsedMs = performance.now() - start;

    expect(page.items).toHaveLength(50);
    // §8: "Filter/sort re-query on 10k-item board < 500ms p75" — doubled
    // for CI/single-sample margin per the caveat above.
    expect(elapsedMs).toBeLessThan(1000);
  });

  it("pagination past the first page also stays within budget", async () => {
    const firstPage = await listItemsInGroup({ organizationId, boardId, groupId, viewConfig: defaultViewConfig, limit: 50 });
    expect(firstPage.nextCursor).not.toBeNull();

    const start = performance.now();
    const secondPage = await listItemsInGroup({
      organizationId,
      boardId,
      groupId,
      viewConfig: defaultViewConfig,
      cursor: firstPage.nextCursor!,
      limit: 50,
    });
    const elapsedMs = performance.now() - start;

    expect(secondPage.items).toHaveLength(50);
    expect(secondPage.items[0]!.id).not.toBe(firstPage.items[0]!.id);
    expect(elapsedMs).toBeLessThan(1000);
  });
});
