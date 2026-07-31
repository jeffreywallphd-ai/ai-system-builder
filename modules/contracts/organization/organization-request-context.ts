import type { OrganizationId } from "./organization-id";

/**
 * Explicit application request context. Active UI selection is not authority;
 * the host must derive this context from an authenticated principal and an
 * active organization membership.
 */
export interface OrganizationRequestContext {
  readonly organizationId: OrganizationId;
  readonly principalId: string;
  readonly requestId?: string;
  readonly correlationId?: string;
}

export interface ActiveOrganizationSelection {
  readonly organizationId?: OrganizationId;
  readonly selectedAt?: string;
}
