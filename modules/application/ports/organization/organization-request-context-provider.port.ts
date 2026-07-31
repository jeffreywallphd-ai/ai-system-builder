import type { OrganizationRequestContext } from "../../../contracts/organization";

/** Host-provided request context; absence is an authorization failure, never a global fallback. */
export interface OrganizationRequestContextProviderPort {
  getCurrentOrganizationContext(): OrganizationRequestContext | undefined;
}
