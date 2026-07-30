export const ORGANIZATION_ROLES = ["owner", "admin", "operator", "member"] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export function isOrganizationRole(value: unknown): value is OrganizationRole {
  return ORGANIZATION_ROLES.includes(value as OrganizationRole);
}

export function normalizeOrganizationRole(value: string): OrganizationRole {
  const normalized = value.trim().toLowerCase();
  if (!isOrganizationRole(normalized)) {
    throw new Error(
      `Organization role must be one of ${ORGANIZATION_ROLES.join(", ")}.`,
    );
  }
  return normalized;
}
