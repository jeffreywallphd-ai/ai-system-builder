import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createTenantPlacementConfig } from "../../../../contracts/config";
import {
  createOrganizationId,
  type OrganizationRole,
} from "../../../../contracts/organization";
import type { SecurityEvent } from "../../../../contracts/security";
import {
  AuthorizeOperationService,
  AuthorizeProviderRepositoryCreationService,
  createOrganizationAuthorizationPolicy,
} from "..";

const organizationId = createOrganizationId("org-a");
const now = "2026-07-27T03:00:00.000Z";

function fixture(initialRole: OrganizationRole) {
  let role = initialRole;
  const events: SecurityEvent[] = [];
  const authorizer = new AuthorizeOperationService(
    createOrganizationAuthorizationPolicy({
      tenantPlacement: createTenantPlacementConfig(),
      organizations: {
        listOrganizations: async () => [],
        readOrganization: async () => ({
          organizationId,
          displayName: "Organization A",
          status: "active",
          createdAt: now,
          updatedAt: now,
        }),
        saveOrganization: async () => undefined,
      },
      memberships: {
        readMembership: async () => ({
          organizationId,
          principalId: "principal-a",
          role,
          status: "active",
          createdAt: now,
          updatedAt: now,
        }),
        listPrincipalMemberships: async () => [],
        saveMembership: async () => undefined,
      },
    }),
    {
      audit: { recordSecurityEvent: async (event) => { events.push(event); } },
      createEventId: () => `event-${events.length + 1}`,
      now: () => now,
    },
  );

  return {
    authorizer,
    service: new AuthorizeProviderRepositoryCreationService({
      organizationContext: {
        getCurrentOrganizationContext: () => ({
          organizationId,
          principalId: "principal-a",
          requestId: "request-a",
        }),
      },
      authorizer,
    }),
    events,
    setRole(nextRole: OrganizationRole) { role = nextRole; },
  };
}

describe("AuthorizeProviderRepositoryCreationService", () => {
  it("denies members and permits operators with audited repository scope", async () => {
    const test = fixture("member");
    const request = {
      provider: "huggingface",
      repository: "example/private-dataset",
      visibility: "private" as const,
    };

    await assert.rejects(() => test.service.authorize(request));
    test.setRole("operator");
    await test.service.authorize(request);

    assert.deepEqual(test.events.map((event) => event.outcome), ["denied", "allowed"]);
    assert.deepEqual(test.events[1]?.resource, {
      kind: "provider-repository",
      id: "huggingface:example/private-dataset",
      organizationId,
      requiresOrganizationOwnership: true,
    });
  });

  it("fails closed without managed organization context", async () => {
    const test = fixture("owner");
    const service = new AuthorizeProviderRepositoryCreationService({
      organizationContext: { getCurrentOrganizationContext: () => undefined },
      authorizer: test.authorizer,
    });

    await assert.rejects(() => service.authorize({
      provider: "huggingface",
      repository: "example/repo",
      visibility: "public",
    }));
  });
});
