import type { OrganizationId } from "./organization-id";

/** Durable identity selected by explicit local first-run initialization. */
export interface LocalIdentityProfile {
  readonly organizationId: OrganizationId;
  readonly principalId: string;
  readonly principalDisplayName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
