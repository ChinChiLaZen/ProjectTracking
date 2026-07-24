import { prisma } from "../db/client";
import { runWithTenant } from "../db/tenantContext";
import { firstRank, rankAfter } from "../../lib/ordering/rank";
import { getColumnType } from "../../lib/columnTypes/types";
import { columnTypeRegistry } from "../../lib/columnTypes/registry";
import type { Prisma } from "../../generated/prisma/client";

export async function createColumnDefinition(params: {
  organizationId: string;
  boardId: string;
  key: string;
  name: string;
  settings?: unknown;
}) {
  const { organizationId, boardId, key, name } = params;
  const columnType = getColumnType(columnTypeRegistry, key);
  const settings = columnType.settingsSchema.parse(params.settings ?? {});

  return runWithTenant(organizationId, async () => {
    const last = await prisma.columnDefinition.findFirst({
      where: { boardId, organizationId },
      orderBy: { rank: "desc" },
    });
    const rank = last ? rankAfter(last.rank) : firstRank();

    return prisma.columnDefinition.create({
      data: { organizationId, boardId, key, name, settings: settings as Prisma.InputJsonValue, rank },
    });
  });
}
