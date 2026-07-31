import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createTenantPlacementConfig } from "../../../../contracts/config";
import { createOrganizationId } from "../../../../contracts/organization";
import type {
  AuthContext,
  SecurityEvent,
} from "../../../../contracts/security";
import {
  AuthorizeOperationService,
  createOrganizationAuthorizationPolicy,
} from "..";

const orgA = createOrganizationId("org-a");
const orgB = createOrganizationId("org-b");
const now = "2026-07-16T00:00:00.000Z";

function auth(principalId = "principal-1"): AuthContext {
  return {
    authenticated: true,
    authMethod: "oidc-bearer",
    principal: {
      principalId,
      kind: "user",
      roles: [],
      scopes: ["workspace:read", "workspace:write"],
    },
  };
}

function policy(input?: {
  organizationStatus?: "active" | "suspended";
  membershipStatus?: "active" | "suspended" | "removed";
  role?: "owner" | "admin" | "operator" | "member";
  placement?: ReturnType<typeof createTenantPlacementConfig>;
}) {
  return createOrganizationAuthorizationPolicy({
    tenantPlacement: input?.placement ?? createTenantPlacementConfig(),
    organizations: {
      listOrganizations: async () => [],
      readOrganization: async (organizationId) => organizationId === orgA ? {
        organizationId,
        displayName: "A",
        status: input?.organizationStatus ?? "active",
        createdAt: now,
        updatedAt: now,
      } : undefined,
      saveOrganization: async () => undefined,
    },
    memberships: {
      readMembership: async ({ organizationId, principalId }) =>
        organizationId === orgA && principalId === "principal-1" ? {
          organizationId,
          principalId,
          role: input?.role ?? "member",
          status: input?.membershipStatus ?? "active",
          createdAt: now,
          updatedAt: now,
        } : undefined,
      listPrincipalMemberships: async () => [],
      saveMembership: async () => undefined,
    },
  });
}

describe("organization authorization policy", () => {
  it("allows an active member with matching resource ownership and scopes", async () => {
    const decision = await policy().authorize({
      authContext: auth(),
      organizationId: orgA,
      operation: "workspace.read",
      requiredScopes: ["workspace:read"],
      resource: { kind: "workspace", id: "workspace-a", organizationId: orgA },
    });
    assert.deepEqual(decision, { allowed: true, organizationRole: "member" });
  });

  it("derives least-privilege capabilities from trusted membership roles", async () => {
    const memberSettingsWrite = await policy({ role: "member" }).authorize({
      authContext: auth(),
      organizationId: orgA,
      operation: "settings.update",
      requiredScopes: ["settings:write"],
    });
    assert.equal(memberSettingsWrite.reasonCode, "missing-scopes");
    assert.deepEqual(memberSettingsWrite.missingScopes, ["settings:write"]);

    const operatorSettingsWrite = await policy({ role: "operator" }).authorize({
      authContext: { ...auth(), principal: { ...auth().principal, scopes: [] } },
      organizationId: orgA,
      operation: "settings.update",
      requiredScopes: ["settings:write"],
    });
    assert.deepEqual(operatorSettingsWrite, {
      allowed: true,
      organizationRole: "operator",
    });
  });

  it("fails closed for managed resources without organization ownership", async () => {
    const decision = await policy().authorize({
      authContext: auth(),
      organizationId: orgA,
      operation: "workspace.read",
      requiredScopes: ["workspace:read"],
      resource: {
        kind: "workspace",
        id: "legacy-workspace",
        requiresOrganizationOwnership: true,
      },
    });
    assert.equal(decision.reasonCode, "resource-organization-required");
  });

  it("denies cross-tenant resources, missing membership, inactive state, and insufficient roles", async () => {
    const base = {
      authContext: auth(),
      organizationId: orgA,
      operation: "workspace.write",
      requiredScopes: ["workspace:write"] as const,
    };
    assert.equal((await policy().authorize({
      ...base,
      requiredScopes: [...base.requiredScopes],
      resource: { kind: "workspace", organizationId: orgB },
    })).reasonCode, "resource-organization-mismatch");
    assert.equal((await policy().authorize({
      ...base,
      authContext: auth("outsider"),
      requiredScopes: [...base.requiredScopes],
    })).reasonCode, "organization-membership-required");
    assert.equal((await policy({ membershipStatus: "suspended" }).authorize({
      ...base,
      requiredScopes: [...base.requiredScopes],
    })).reasonCode, "organization-membership-inactive");
    assert.equal((await policy({ organizationStatus: "suspended" }).authorize({
      ...base,
      requiredScopes: [...base.requiredScopes],
    })).reasonCode, "organization-suspended");
    assert.equal((await policy({ role: "member" }).authorize({
      ...base,
      requiredScopes: [...base.requiredScopes],
      requiredOrganizationRoles: ["owner", "admin"],
    })).reasonCode, "organization-role-insufficient");
  });

  it("rejects other organizations in premium dedicated placement", async () => {
    const dedicated = createTenantPlacementConfig({
      mode: "dedicated",
      organizationId: "org-a",
    });
    const decision = await policy({ placement: dedicated }).authorize({
      authContext: auth(),
      organizationId: orgB,
      operation: "workspace.read",
      requiredScopes: ["workspace:read"],
    });
    assert.equal(decision.reasonCode, "tenant-placement-denied");
  });

  it("audits allow and denial without putting policy details in diagnostics", async () => {
    const events: SecurityEvent[] = [];
    const service = new AuthorizeOperationService(policy(), {
      audit: { recordSecurityEvent: async (event) => { events.push(event); } },
      createEventId: () => "event-1",
      now: () => now,
    });
    await service.execute({
      authContext: auth(),
      organizationId: orgA,
      operation: "workspace.read",
      requiredScopes: ["workspace:read"],
    });
    await assert.rejects(() => service.execute({
      authContext: auth("outsider"),
      organizationId: orgA,
      operation: "workspace.read",
      requiredScopes: ["workspace:read"],
    }));
    assert.deepEqual(events.map(({ kind, outcome }) => ({ kind, outcome })), [
      { kind: "authz.allowed", outcome: "allowed" },
      { kind: "authz.denied", outcome: "denied" },
    ]);
    assert.equal(events[0]?.organizationRole, "member");
    assert.equal(JSON.stringify(events).includes("token"), false);
  });
});
