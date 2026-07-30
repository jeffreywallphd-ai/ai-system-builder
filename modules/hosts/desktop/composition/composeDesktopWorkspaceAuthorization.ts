import { randomUUID } from "node:crypto";

import {
  AuthorizeOperationService,
  AuthorizeWorkspaceOperationService,
  createOrganizationAuthorizationPolicy,
} from "../../../application/services/security";
import type { SecurityAuditLogPort } from "../../../application/ports/security";
import { createStructuredOrganizationRepositories } from "../../../adapters/persistence/organization";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import { createTenantPlacementConfig } from "../../../contracts/config";
import type { LocalIdentityProfile } from "../../../contracts/organization";

export function composeDesktopWorkspaceAuthorization(input: {
  documents: StructuredDocumentStore;
  localIdentity: LocalIdentityProfile;
  audit?: SecurityAuditLogPort;
  now?: () => string;
}): AuthorizeWorkspaceOperationService {
  const repositories = createStructuredOrganizationRepositories(
    input.documents,
  );
  const policy = createOrganizationAuthorizationPolicy({
    organizations: repositories.organizations,
    memberships: repositories.memberships,
    tenantPlacement: createTenantPlacementConfig({
      mode: "dedicated",
      organizationId: input.localIdentity.organizationId,
    }),
  });
  const authorizer = new AuthorizeOperationService(policy, {
    audit: input.audit,
    createEventId: randomUUID,
    now: input.now,
  });
  return new AuthorizeWorkspaceOperationService({
    organizationContext: {
      getCurrentOrganizationContext: () => ({
        organizationId: input.localIdentity.organizationId,
        principalId: input.localIdentity.principalId,
      }),
    },
    authorizer,
  });
}
