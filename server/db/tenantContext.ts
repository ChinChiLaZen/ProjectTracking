import { AsyncLocalStorage } from "node:async_hooks";

type TenantStore = { organizationId: string };

const tenantContext = new AsyncLocalStorage<TenantStore>();

export function runWithTenant<T>(organizationId: string, fn: () => T): T {
  return tenantContext.run({ organizationId }, fn);
}

export function getTenantOrganizationId(): string | undefined {
  return tenantContext.getStore()?.organizationId;
}
