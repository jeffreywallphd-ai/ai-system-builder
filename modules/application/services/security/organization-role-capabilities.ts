import type { OrganizationRole } from "../../../contracts/organization";
import type { SecurityScope } from "../../../contracts/security";

const MEMBER_CAPABILITIES = [
  "artifact:read",
  "artifact:write",
  "asset:read",
  "asset:write",
  "workspace:read",
  "model:read",
  "model:write",
  "image-generation:read",
  "image-generation:write",
  "runtime:read",
  "settings:read",
  "provider-credential:use",
] as const satisfies readonly SecurityScope[];

const OPERATOR_CAPABILITIES = [
  ...MEMBER_CAPABILITIES,
  "workspace:write",
  "runtime:admin",
  "settings:write",
  "provider-credential:read",
  "provider-credential:write",
  "provider-repository:create",
] as const satisfies readonly SecurityScope[];

const ADMINISTRATOR_CAPABILITIES = [
  ...OPERATOR_CAPABILITIES,
  "security:admin",
] as const satisfies readonly SecurityScope[];

export const ORGANIZATION_ROLE_CAPABILITIES: Readonly<
  Record<OrganizationRole, readonly SecurityScope[]>
> = {
  member: MEMBER_CAPABILITIES,
  operator: OPERATOR_CAPABILITIES,
  admin: ADMINISTRATOR_CAPABILITIES,
  owner: ADMINISTRATOR_CAPABILITIES,
};

export function capabilitiesForOrganizationRole(
  role: OrganizationRole,
): readonly SecurityScope[] {
  return ORGANIZATION_ROLE_CAPABILITIES[role];
}
