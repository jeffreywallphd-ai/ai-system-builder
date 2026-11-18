import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {createInMemoryStructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {createStructuredOrganizationRepositories} from "../../../../adapters/persistence/organization";
import {createLocalWorkspaceRepository} from "../../../../adapters/persistence/workspace";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {isHeadlessHostIncarnationId, type UiDataPresentationIntent} from "../../../../contracts/headless";
import {composeDesktopUiControl} from "../composeDesktopUiControl";

for (const intent of [
  {action: "show-data-source", taskId: "source.task", fileId: "source.file", taskRevision: 1},
  {action: "show-dataset-version", datasetId: "dataset.synthetic", versionId: "version.synthetic", versionDigest: `sha256:${"a".repeat(64)}`},
  {action: "show-dataset-task", taskId: "ca353bdd-7793-44c6-8c36-c470be8c537c"},
] as const satisfies readonly UiDataPresentationIntent[]) test(`Desktop ${intent.action} rechecks current policy before and after metadata`, async () => {
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
