import type { OrganizationId } from "./organization-id";

export const ORGANIZATION_STATUSES = ["active", "suspended"] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export interface OrganizationRecord {
  readonly organizationId: OrganizationId;
  readonly displayName: string;
  readonly status: OrganizationStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function isOrganizationStatus(value: unknown): value is OrganizationStatus {
  return ORGANIZATION_STATUSES.includes(value as OrganizationStatus);
}
