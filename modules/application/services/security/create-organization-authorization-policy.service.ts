import {
  missingSecurityScopes,
  type AuthorizationDecision,
  type AuthorizationRequest,
} from "../../../contracts/security";
import {
  tenantPlacementAllowsOrganization,
  type TenantPlacementConfig,
} from "../../../contracts/config";
import type {
  OrganizationMembershipRepositoryPort,
  OrganizationRepositoryPort,
} from "../../ports/organization";
import type { AuthorizationPolicyPort } from "../../ports/security";
import { capabilitiesForOrganizationRole } from "./organization-role-capabilities";

export function createOrganizationAuthorizationPolicy(deps: {
  organizations: OrganizationRepositoryPort;
  memberships: OrganizationMembershipRepositoryPort;
  tenantPlacement: TenantPlacementConfig;
}): AuthorizationPolicyPort {
  return {
    async authorize(request): Promise<AuthorizationDecision> {
      if (!request.authContext.authenticated || request.authContext.principal.kind === "anonymous") {
        return denied("unauthenticated", "Authentication is required.", request);
      }
      if (!request.organizationId) {
        return denied(
          "organization-required",
          "An organization context is required.",
          request,
        );
      }
      if (!tenantPlacementAllowsOrganization(
        deps.tenantPlacement,
        request.organizationId,
      )) {
        return denied(
          "tenant-placement-denied",
          "The organization is not assigned to this deployment.",
          request,
        );
      }
      if (
        request.resource?.requiresOrganizationOwnership &&
        !request.resource.organizationId
      ) {
        return denied(
          "resource-organization-required",
          "The resource has not been assigned to an organization.",
          request,
        );
      }
      if (
        request.resource?.organizationId &&
        request.resource.organizationId !== request.organizationId
      ) {
        return denied(
          "resource-organization-mismatch",
          "The resource does not belong to the active organization.",
          request,
        );
      }
      const organization = await deps.organizations.readOrganization(
        request.organizationId,
      );
      if (!organization) {
        return denied(
          "organization-unavailable",
          "The organization is unavailable.",
          request,
        );
      }
      if (organization.status !== "active") {
        return denied(
          "organization-suspended",
          "The organization is not active.",
          request,
        );
      }
      const membership = await deps.memberships.readMembership({
        organizationId: request.organizationId,
        principalId: request.authContext.principal.principalId,
      });
      if (!membership) {
        return denied(
          "organization-membership-required",
          "Active organization membership is required.",
          request,
        );
      }
      if (membership.status !== "active") {
        return denied(
          "organization-membership-inactive",
          "Organization membership is not active.",
          request,
        );
      }
      if (
        request.requiredOrganizationRoles?.length &&
        !request.requiredOrganizationRoles.includes(membership.role)
      ) {
        return {
          ...denied(
          "organization-role-insufficient",
          "The organization role does not permit this operation.",
          request,
          ),
          organizationRole: membership.role,
        };
      }
      const missingScopes = missingSecurityScopes(
        capabilitiesForOrganizationRole(membership.role),
        request.requiredScopes,
      );
      if (missingScopes.length > 0) {
        return {
          ...denied(
            "missing-scopes",
            "Required operation scopes are missing.",
            request,
          ),
          organizationRole: membership.role,
          missingScopes,
        };
      }
      return { allowed: true, organizationRole: membership.role };
    },
  };
}

function denied(
  reasonCode: NonNullable<AuthorizationDecision["reasonCode"]>,
  reason: string,
  _request: AuthorizationRequest,
): AuthorizationDecision {
  return { allowed: false, reasonCode, reason };
}
