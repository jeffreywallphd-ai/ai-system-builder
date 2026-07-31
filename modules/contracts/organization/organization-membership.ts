import type { OrganizationId } from "./organization-id";
import type { OrganizationRole } from "./organization-role";

export const ORGANIZATION_MEMBERSHIP_STATUSES = [
  "active",
  "suspended",
  "removed",
] as const;
export type OrganizationMembershipStatus =
  (typeof ORGANIZATION_MEMBERSHIP_STATUSES)[number];

export interface OrganizationMembership {
  readonly organizationId: OrganizationId;
  readonly principalId: string;
  readonly role: OrganizationRole;
  readonly status: OrganizationMembershipStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function isOrganizationMembershipStatus(
  value: unknown,
): value is OrganizationMembershipStatus {
  return ORGANIZATION_MEMBERSHIP_STATUSES.includes(
    value as OrganizationMembershipStatus,
  );
}
