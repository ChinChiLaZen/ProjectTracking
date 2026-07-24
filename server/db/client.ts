import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { getTenantOrganizationId } from "./tenantContext";

// §4.2: organizationId predicates in service-layer queries are the primary
// defense. This extension is the second line of defense — it throws if a
// query against a tenant-owned model runs inside a request (tenant context
// set) without an organizationId filter/value matching that tenant, so a
// missing predicate fails loud instead of silently leaking cross-tenant data.
const TENANT_SCOPED_MODELS = new Set([
  "Workspace",
  "Board",
  "Group",
  "Item",
  "ColumnDefinition",
  "ColumnValue",
  "ActivityLog",
  "OutboxEvent",
]);
// ColumnValue/ActivityLog/OutboxEvent are append-only or overwrite-in-place
// (no deletedAt column) — soft delete only applies to Group/Item/ColumnDefinition.
const SOFT_DELETE_MODELS = new Set(["Workspace", "Board", "Group", "Item", "ColumnDefinition"]);
const READ_OPS = new Set(["findMany", "findFirst", "count"]);
const WHERE_OPS = new Set(["findMany", "findFirst", "findUnique", "update", "updateMany", "delete", "deleteMany", "count"]);

function assertTenantScoped(model: string, operation: string, args: Record<string, unknown>, expectedOrgId: string) {
  if (operation === "create") {
    const data = (args.data ?? {}) as Record<string, unknown>;
    if (data.organizationId !== expectedOrgId) {
      throw new Error(`Tenant scoping violation: ${model}.create missing/mismatched organizationId`);
    }
    return;
  }
  if (WHERE_OPS.has(operation)) {
    const where = (args.where ?? {}) as Record<string, unknown>;
    if (where.organizationId !== expectedOrgId) {
      throw new Error(`Tenant scoping violation: ${model}.${operation} missing/mismatched organizationId in where`);
    }
  }
}

function withDefensiveScoping(client: PrismaClient) {
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const typedArgs = args as Record<string, unknown>;

          if (model && SOFT_DELETE_MODELS.has(model) && READ_OPS.has(operation)) {
            const where = (typedArgs.where ?? {}) as Record<string, unknown>;
            if (where.deletedAt === undefined) {
              typedArgs.where = { ...where, deletedAt: null };
            }
          }

          if (model && TENANT_SCOPED_MODELS.has(model)) {
            const expectedOrgId = getTenantOrganizationId();
            if (expectedOrgId) {
              assertTenantScoped(model, operation, typedArgs, expectedOrgId);
            }
          }

          return query(typedArgs as never);
        },
      },
    },
  });
}

declare global {
  var __prisma: ReturnType<typeof buildClient> | undefined;
}

function buildClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const client = new PrismaClient({ adapter });
  return withDefensiveScoping(client);
}

export const prisma = globalThis.__prisma ?? buildClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}
