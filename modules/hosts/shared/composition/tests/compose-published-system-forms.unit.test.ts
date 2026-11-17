import assert from "node:assert/strict";
import test from "node:test";
import { createOrganizationId, type OrganizationMembership, type OrganizationRequestContext } from "../../../../contracts/organization";
import { createSha256SystemBuildHasher } from "../../../../adapters/storage/system-build";
import { composePublishedSystemForms, readPublishedFormAuthority } from "../composePublishedSystemForms";

const organizationId = createOrganizationId("organization-forms");
const principalId = "principal-form-owner";
const timestamp = "2026-11-12T10:00:00.000Z";

function boundary() {
  let context: OrganizationRequestContext | undefined = { organizationId, principalId };
  let membership: OrganizationMembership | undefined = { organizationId, principalId, role: "owner", status: "active", createdAt: timestamp, updatedAt: timestamp };
  const checks: string[][] = [];
  return {
    checks,
    scope: {
      organizations: { getCurrentOrganizationContext: () => context },
      memberships: { readMembership: async (input: { organizationId: string; principalId: string }) =>
        input.organizationId === organizationId && input.principalId === principalId ? membership : undefined },
      workspaceAccess: { async authorize(workspace: string, operation: string, scope: string) {
        checks.push([workspace, operation, scope]);
        if (workspace !== "workspace-forms") throw new Error("private workspace context");
      } },
    },
    setContext: (next: OrganizationRequestContext | undefined) => { context = next; },
    setMembership: (next: Partial<OrganizationMembership>) => { membership = { ...membership!, ...next }; },
  };
}

test("the host fences the authenticated actor and rechecks the same workspace and membership", async () => {
  const host = boundary();
  assert.equal(readPublishedFormAuthority(host.scope, "workspace-forms", "asset:write", "other-actor"), undefined);
  const authority = readPublishedFormAuthority(host.scope, "workspace-forms", "asset:write", principalId);
  assert.ok(authority);
  assert.deepEqual(await authority.readPrincipal(), { actorId: principalId, authenticated: true, roles: ["owner"] });
  host.setMembership({ role: "member" });
  assert.deepEqual((await authority.readPrincipal())?.roles, ["member"]);
  host.setMembership({ status: "suspended" });
  assert.equal(await authority.readPrincipal(), undefined);
  host.setContext(undefined);
  assert.equal(await authority.readPrincipal(), undefined);
  assert.deepEqual(host.checks, Array.from({ length: 3 }, () => ["workspace-forms", "system-form.submit", "asset:write"]));
});

test("the composed list and submit deny a foreign workspace before reading release or writing answers", async () => {
  const host = boundary();
  let reads = 0;
  let writes = 0;
  const gateway = composePublishedSystemForms({ ...host.scope, hasher: createSha256SystemBuildHasher(),
    builds: { readRelease: async () => { reads++; return undefined; } },
    systems: { readRecord: async () => undefined, readRevision: async () => undefined },
    artifacts: { readVerified: async () => { throw new Error("not reached"); } },
    revocations: { listRevokedImplementationReleaseIds: async () => [] },
    systemData: { definitions: { resolve: async () => undefined }, runtime: { createFormRecordOnce: async () => { writes++; return "completed"; } } },
  });
  const selection = { workspaceId: "workspace-other", releaseId: `system-release:${"a".repeat(64)}` };
  assert.equal((await gateway.list(selection, principalId)).ok, false);
  assert.deepEqual(await gateway.submit({ ...selection, formId: "form-a", submissionId: "9a37938e-de87-4a3d-b9ac-97828b96290f", answers: {} }, principalId),
    { ok: true, value: { status: "denied" } });
  assert.equal(reads, 0);
  assert.equal(writes, 0);
  assert.deepEqual(host.checks.map((check) => check[2]), ["asset:read", "asset:write"]);
  const owned = { ...selection, workspaceId: "workspace-forms" };
  host.setMembership({ status: "suspended" });
  assert.equal((await gateway.list(owned, principalId)).ok, false);
  assert.deepEqual(await gateway.submit({ ...owned, formId: "form-a", submissionId: "9a37938e-de87-4a3d-b9ac-97828b96290f", answers: {} }, principalId),
    { ok: true, value: { status: "denied" } });
  assert.equal(reads, 0);
  assert.equal(writes, 0);
});
