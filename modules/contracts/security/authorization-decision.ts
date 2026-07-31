import type { AuthContext } from "./auth-context";
import type { SecurityScope } from "./auth-scope";
import type { OrganizationId, OrganizationRole } from "../organization";

export interface AuthorizationResource {
  kind: string;
  id?: string;
  organizationId?: OrganizationId;
  workspaceId?: string;
  /** Fail closed when a managed resource has not been assigned to an organization. */
  requiresOrganizationOwnership?: boolean;
}

export interface AuthorizationRequest {
  authContext: AuthContext;
  organizationId?: OrganizationId;
  requestId?: string;
  correlationId?: string;
  operation: string;
  requiredScopes: SecurityScope[];
  requiredOrganizationRoles?: OrganizationRole[];
  resource?: AuthorizationResource;
}

export const AUTHORIZATION_REASON_CODES = [
  "unauthenticated",
  "organization-required",
  "organization-unavailable",
  "organization-suspended",
  "organization-membership-required",
  "organization-membership-inactive",
  "organization-role-insufficient",
  "tenant-placement-denied",
  "resource-organization-required",
  "resource-organization-mismatch",
  "missing-scopes",
] as const;

export type AuthorizationReasonCode =
  (typeof AUTHORIZATION_REASON_CODES)[number];

export interface AuthorizationDecision {
  allowed: boolean;
  organizationRole?: OrganizationRole;
  reasonCode?: AuthorizationReasonCode;
  reason?: string;
  missingScopes?: SecurityScope[];
}
