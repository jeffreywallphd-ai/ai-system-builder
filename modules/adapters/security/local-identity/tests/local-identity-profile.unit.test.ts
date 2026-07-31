import assert from "node:assert/strict";
import test from "node:test";

import { createInMemoryStructuredDocumentStore } from "../../../persistence/shared";
import { createStructuredOrganizationRepositories } from "../../../persistence/organization";
import { initializeLocalIdentityProfile, readLocalIdentityProfile } from "../localIdentityProfile";

test("explicit local identity initialization atomically creates a durable owner profile", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  let sequence = 0;
  const profile = await initializeLocalIdentityProfile({
    documents,
    organizationDisplayName: " Local Lab ",
    principalDisplayName: " Local Owner ",
    now: () => "2026-07-16T12:00:00.000Z",
    createId: () => `generated-${++sequence}`,
  });

  assert.equal(profile.organizationId, "org-generated-1");
  assert.equal(profile.principalId, "local-principal-generated-2");
  assert.equal(profile.principalDisplayName, "Local Owner");
  assert.deepEqual(await readLocalIdentityProfile(documents), profile);
  const repositories = createStructuredOrganizationRepositories(documents);
  assert.equal(
    (await repositories.organizations.readOrganization(profile.organizationId))?.displayName,
    "Local Lab",
  );
  assert.deepEqual(
    await repositories.memberships.readMembership({
      organizationId: profile.organizationId,
      principalId: profile.principalId,
    }),
    {
      organizationId: profile.organizationId,
      principalId: profile.principalId,
      role: "owner",
      status: "active",
      createdAt: "2026-07-16T12:00:00.000Z",
      updatedAt: "2026-07-16T12:00:00.000Z",
    },
  );
  await assert.rejects(
    () => initializeLocalIdentityProfile({
      documents,
      organizationDisplayName: "Other",
      principalDisplayName: "Other",
    }),
    /already initialized/,
  );
});

test("failed local profile initialization leaves no partial organization", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  await assert.rejects(
    () => initializeLocalIdentityProfile({
      documents,
      organizationDisplayName: "Local",
      principalDisplayName: "Owner",
      createId: () => "bad/id",
    }),
    /Organization id/,
  );
  assert.equal(await readLocalIdentityProfile(documents), undefined);
  assert.deepEqual(await createStructuredOrganizationRepositories(documents).organizations.listOrganizations(), []);
});
