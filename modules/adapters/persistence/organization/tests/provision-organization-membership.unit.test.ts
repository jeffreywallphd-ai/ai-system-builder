import assert from "node:assert/strict";
import test from "node:test";

import { createOrganizationId } from "../../../../contracts/organization";
import { createInMemoryStructuredDocumentStore } from "../../shared";
import { createStructuredOrganizationRepositories } from "../createStructuredOrganizationRepositories";
import { provisionOrganizationMembership } from "../provisionOrganizationMembership";

test("privileged provisioning creates and then safely updates one OIDC membership", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  const organizationId = createOrganizationId("org-a");
  const first = await provisionOrganizationMembership({
    documents,
    organizationId,
    organizationDisplayName: "Organization A",
    principalId: "principal-hash",
    role: "owner",
    now: () => "2026-07-16T12:00:00.000Z",
  });
  const second = await provisionOrganizationMembership({
    documents,
    organizationId,
    organizationDisplayName: "Organization A",
    principalId: "principal-hash",
    role: "admin",
    now: () => "2026-07-16T13:00:00.000Z",
  });
  assert.deepEqual(first, { organizationCreated: true, membershipCreated: true });
  assert.deepEqual(second, { organizationCreated: false, membershipCreated: false });
  const membership = await createStructuredOrganizationRepositories(documents).memberships.readMembership({
    organizationId,
    principalId: "principal-hash",
  });
  assert.equal(membership?.role, "admin");
  assert.equal(membership?.createdAt, "2026-07-16T12:00:00.000Z");
  assert.equal(membership?.updatedAt, "2026-07-16T13:00:00.000Z");
});
