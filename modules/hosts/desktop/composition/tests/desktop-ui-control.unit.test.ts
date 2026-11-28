import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {createInMemoryStructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {createStructuredOrganizationRepositories} from "../../../../adapters/persistence/organization";
import {createLocalWorkspaceRepository} from "../../../../adapters/persistence/workspace";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {isHeadlessHostIncarnationId, type UiDataPresentationIntent, type UiContextPresentationIntent} from "../../../../contracts/headless";
import {AuthorizeWorkspaceOperationService} from "../../../../application/services/security";
import {composeDesktopUiControl} from "../composeDesktopUiControl";

for (const intent of [
  {action: "show-data-source", taskId: "source.task", fileId: "source.file", taskRevision: 1},
  {action: "show-dataset-version", datasetId: "dataset.synthetic", versionId: "version.synthetic", versionDigest: `sha256:${"a".repeat(64)}`},
  {action: "show-dataset-task", taskId: "ca353bdd-7793-44c6-8c36-c470be8c537c"},
  {action: "show-context-task", taskId: "ca353bdd-7793-44c6-8c36-c470be8c537c"},
  {action: "show-context-query", taskId: "ca353bdd-7793-44c6-8c36-c470be8c537c"},
  {action: "show-context-artifact", reference: {workspaceId: createWorkspaceId("data-window-workspace"),
    contextId: "ca353bdd-7793-44c6-8c36-c470be8c537d", taskId: "ca353bdd-7793-44c6-8c36-c470be8c537c",
    kind: "rag-database", artifactDigest: `sha256:${"a".repeat(64)}`}},
] as const satisfies readonly (UiDataPresentationIntent | UiContextPresentationIntent)[]) test(`Desktop ${intent.action} rechecks current policy before and after metadata`, async () => {
  const documents = createInMemoryStructuredDocumentStore(), organizationId = createOrganizationId("data-window-org"),
    workspaceId = createWorkspaceId("data-window-workspace"), at = "2026-11-18T00:00:00.000Z";
  const identity = {organizationId, principalId: "data-window-principal", principalDisplayName: "Synthetic", createdAt: at, updatedAt: at};
  const repositories = createStructuredOrganizationRepositories(documents);
  await repositories.organizations.saveOrganization({organizationId, displayName: "Synthetic", status: "active", createdAt: at, updatedAt: at});
  const membership = {organizationId, principalId: identity.principalId, role: "owner" as const, createdAt: at, updatedAt: at};
  await repositories.memberships.saveMembership({...membership, status: "active"});
  const workspaces = createLocalWorkspaceRepository({rootDirectory: ".", documents: documents.forOrganization(organizationId)});
  await workspaces.saveWorkspace({organizationId, workspaceId, displayName: "Synthetic", status: "active", createdAt: at, updatedAt: at});
  const hostIncarnationId = randomUUID(); assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));
  let reads = 0, revokeDuringRead = false;
  const control = composeDesktopUiControl({documents, identity, hostIncarnationId, rootDirectory: ".", isOpen: () => true,
    async canPresent(actualWorkspace, actualIntent, stillAllowed) {
      reads++; assert.equal(actualWorkspace, workspaceId); assert.deepEqual(actualIntent, intent); assert.equal(await stillAllowed(), true);
      if (revokeDuringRead) {
        await repositories.memberships.saveMembership({...membership, status: "suspended"});
        assert.equal(await stillAllowed(), false);
      }
      return {title: "Saved Data resource"};
    }});
  try {
    assert.deepEqual(await control.authorizeIntent(workspaceId, intent), {title: "Saved Data resource"});
    revokeDuringRead = true;
    assert.equal(await control.authorizeIntent(workspaceId, intent), undefined);
    assert.equal(reads, 2);
    assert.equal(await control.authorizeIntent(workspaceId, intent), undefined);
    assert.equal(reads, 2, "A suspended actor must not read more metadata.");
  } finally {control.close();}
});


for (const intent of [{action: "show-context-query", taskId: "ca353bdd-7793-44c6-8c36-c470be8c537c"},
  {action: "show-model", modelRecordId: "model.saved", modelUpdatedAt: "2026-11-28T00:00:00.000Z"}] as const)
test(`${intent.action} requires ModelRead before metadata and at final publication`, async t => {
  const documents = createInMemoryStructuredDocumentStore(), organizationId = createOrganizationId("org.query-window");
  const workspaceId = createWorkspaceId("workspace.query-window"), hostIncarnationId = randomUUID(); assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));
  const at = "2026-11-18T00:00:00.000Z", identity = {organizationId, principalId: "principal.synthetic", principalDisplayName: "Synthetic", createdAt: at, updatedAt: at};
  const repositories = createStructuredOrganizationRepositories(documents);
  await repositories.organizations.saveOrganization({organizationId, displayName: "Synthetic", status: "active", createdAt: at, updatedAt: at});
  await repositories.memberships.saveMembership({organizationId, principalId: identity.principalId, role: "owner", status: "active", createdAt: at, updatedAt: at});
  await createLocalWorkspaceRepository({rootDirectory: ".", documents: documents.forOrganization(organizationId)}).saveWorkspace({
    organizationId, workspaceId, status: "active", displayName: "Synthetic", createdAt: at, updatedAt: at});
  let modelAllowed = false, revokeAtReturn = false, metadataReads = 0, modelChecks = 0;
  const original = AuthorizeWorkspaceOperationService.prototype.authorizeWorkspaceOperation;
  t.mock.method(AuthorizeWorkspaceOperationService.prototype, "authorizeWorkspaceOperation", async function(this: AuthorizeWorkspaceOperationService, input) {
    if (input.requiredScopes.includes("model:read")) {modelChecks++; if (!modelAllowed) throw new Error("Synthetic model permission withdrawn.");}
    return original.call(this, input);
  });
  const control = composeDesktopUiControl({documents, identity, hostIncarnationId, rootDirectory: ".", isOpen: () => true,
    async canPresent() {metadataReads++; if (revokeAtReturn) modelAllowed = false; return {title: "Synthetic query summary"};}});
  const query = intent;
  try {
    assert.equal(await control.authorizeIntent(workspaceId, query), undefined); assert.equal(metadataReads, 0);
    assert.ok(await control.authorizeIntent(workspaceId, {action: "show-context-task", taskId: randomUUID()}));
    assert.equal(metadataReads, 1, "Generation task display keeps artifact-only permission.");
    modelAllowed = true; assert.ok(await control.authorizeIntent(workspaceId, query)); assert.equal(metadataReads, 2);
    revokeAtReturn = true; assert.equal(await control.authorizeIntent(workspaceId, query), undefined);
    assert.equal(metadataReads, 3); assert.ok(modelChecks >= 5, "ModelRead must also guard the final post-metadata edge.");
  } finally {control.close();}
});
