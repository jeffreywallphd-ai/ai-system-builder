import { AsyncLocalStorage } from "node:async_hooks";

import type { OrganizationRequestContextProviderPort } from "../../../../application/ports/organization";
import type { OrganizationRequestContext } from "../../../../contracts/organization";

export interface ExpressOrganizationContextScope extends OrganizationRequestContextProviderPort {
  runWithOrganizationContext<T>(context: OrganizationRequestContext, work: () => T): T;
}

export function createExpressOrganizationContextScope(): ExpressOrganizationContextScope {
  const storage = new AsyncLocalStorage<OrganizationRequestContext>();
  return {
    getCurrentOrganizationContext: () => storage.getStore(),
    runWithOrganizationContext: (context, work) => storage.run(context, work),
  };
}
