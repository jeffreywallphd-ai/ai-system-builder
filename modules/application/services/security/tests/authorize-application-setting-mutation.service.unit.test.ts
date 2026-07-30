import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createTenantPlacementConfig } from "../../../../contracts/config";
import {
  createOrganizationId,
  type OrganizationRole,
} from "../../../../contracts/organization";
import type { SecurityEvent } from "../../../../contracts/security";
import {
  AuthorizeApplicationSettingMutationService,
  AuthorizeOperationService,
  createOrganizationAuthorizationPolicy,
} from "..";

const organizationId = createOrganizationId("org-a");
const now = "2026-07-27T02:00:00.000Z";

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
    service: new AuthorizeApplicationSettingMutationService({
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

describe("AuthorizeApplicationSettingMutationService", () => {
  it("denies ordinary members and permits operators for non-administrator settings", async () => {
    const test = fixture("member");
    await assert.rejects(() => test.service.authorizeSettingMutation({
      key: "huggingface.defaultNamespace",
      operation: "update",
    }));
    test.setRole("operator");
    await test.service.authorizeSettingMutation({
      key: "huggingface.defaultNamespace",
      operation: "update",
    });
    assert.deepEqual(test.events.map((event) => event.outcome), ["denied", "allowed"]);
  });

  it("requires an administrator for CUDA indexes and audits the safe setting target", async () => {
    const test = fixture("operator");
    await assert.rejects(() => test.service.authorizeSettingMutation({
      key: "runtime.torch.cudaWheelIndexUrl",
      operation: "update",
    }));
    test.setRole("admin");
    await test.service.authorizeSettingMutation({
      key: "runtime.torch.cudaWheelIndexUrl",
      operation: "update",
    });
    assert.equal(test.events[0]?.details?.reasonCode, "organization-role-insufficient");
    assert.deepEqual(test.events[1]?.resource, {
      kind: "application-setting",
      id: "runtime.torch.cudaWheelIndexUrl",
      organizationId,
      requiresOrganizationOwnership: true,
    });
  });
});

