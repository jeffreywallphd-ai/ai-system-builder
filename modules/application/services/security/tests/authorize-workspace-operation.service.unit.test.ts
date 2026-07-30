import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createTenantPlacementConfig } from "../../../../contracts/config";
import { createOrganizationId } from "../../../../contracts/organization";
import type { SecurityEvent } from "../../../../contracts/security";
import { createWorkspaceId, type WorkspaceRecord } from "../../../../contracts/workspace";
import {
  AuthorizeOperationService,
  AuthorizeWorkspaceOperationService,
  createOrganizationAuthorizationPolicy,
} from "..";

const orgA = createOrganizationId("org-a");
const orgB = createOrganizationId("org-b");
const now = "2026-07-27T00:00:00.000Z";

function workspace(organizationId = orgA): WorkspaceRecord {
  return {
    organizationId,
    workspaceId: createWorkspaceId("same-workspace-id"),
    displayName: "Workspace",
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

function service(events: SecurityEvent[]) {
  const policy = createOrganizationAuthorizationPolicy({
    tenantPlacement: createTenantPlacementConfig(),
    organizations: {
      listOrganizations: async () => [],
      readOrganization: async (organizationId) => organizationId === orgA ? {
        organizationId: orgA,
        displayName: "A",
        status: "active",
        createdAt: now,
        updatedAt: now,
      } : undefined,
      saveOrganization: async () => undefined,
    },
    memberships: {
      readMembership: async ({ organizationId, principalId }) =>
        organizationId === orgA && principalId === "principal-a" ? {
          organizationId: orgA,
          principalId,
          role: "member",
          status: "active",
          createdAt: now,
          updatedAt: now,
        } : undefined,
      listPrincipalMemberships: async () => [],
      saveMembership: async () => undefined,
    },
  });
  return new AuthorizeWorkspaceOperationService({
    organizationContext: {
      getCurrentOrganizationContext: () => ({
        organizationId: orgA,
        principalId: "principal-a",
        requestId: "request-a",
      }),
    },
    authorizer: new AuthorizeOperationService(policy, {
      audit: { recordSecurityEvent: async (event) => { events.push(event); } },
      createEventId: () => `event-${events.length + 1}`,
      now: () => now,
    }),
  });
}

describe("AuthorizeWorkspaceOperationService", () => {
  it("allows a matching organization and records actor, role, operation, and resource", async () => {
    const events: SecurityEvent[] = [];
    await service(events).authorizeWorkspaceOperation({
      workspace: workspace(),
      operation: "artifact.browse",
      requiredScopes: ["artifact:read"],
    });
    assert.deepEqual(events[0], {
      eventId: "event-1",
      kind: "authz.allowed",
      occurredAt: now,
      principalId: "principal-a",
      organizationId: orgA,
      organizationRole: "member",
      requestId: "request-a",
      correlationId: undefined,
      operation: "artifact.browse",
      resource: {
        kind: "workspace",
        id: "same-workspace-id",
        workspaceId: "same-workspace-id",
        organizationId: orgA,
        requiresOrganizationOwnership: true,
      },
      outcome: "allowed",
      details: undefined,
    });
  });

  it("denies the same workspace id when persisted ownership belongs to another organization", async () => {
    const events: SecurityEvent[] = [];
    await assert.rejects(() => service(events).authorizeWorkspaceOperation({
      workspace: workspace(orgB),
      operation: "artifact.delete",
      requiredScopes: ["artifact:write"],
    }));
    assert.equal(events[0]?.outcome, "denied");
    assert.equal(events[0]?.details?.reasonCode, "resource-organization-mismatch");
    assert.equal(events[0]?.resource?.organizationId, orgB);
  });
});
