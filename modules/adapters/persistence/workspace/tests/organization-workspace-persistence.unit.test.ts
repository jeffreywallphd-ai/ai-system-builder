import assert from "node:assert/strict";
import test from "node:test";

import { createOrganizationId } from "../../../../contracts/organization";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createInMemoryStructuredDocumentStore } from "../../shared";
import { createLocalWorkspaceRepository } from "../createLocalWorkspaceRepository";

test("organization-scoped workspace persistence requires matching record ownership", async () => {
  const root = createInMemoryStructuredDocumentStore();
  const orgA = createOrganizationId("org-a");
  const orgB = createOrganizationId("org-b");
  const repository = createLocalWorkspaceRepository({
    rootDirectory: "/logical-root",
    documents: root.forOrganization(orgA),
  });
  const base = {
    workspaceId: createWorkspaceId("workspace-a"),
    displayName: "Workspace A",
    status: "active" as const,
    createdAt: "2026-07-16T12:00:00.000Z",
    updatedAt: "2026-07-16T12:00:00.000Z",
  };
  await assert.rejects(() => repository.saveWorkspace(base), /invalid record/);
  await assert.rejects(
    () => repository.saveWorkspace({ ...base, organizationId: orgB }),
    /invalid record/,
  );
  await repository.saveWorkspace({ ...base, organizationId: orgA });
  assert.equal((await repository.readWorkspace(base.workspaceId))?.organizationId, orgA);
  assert.deepEqual(await createLocalWorkspaceRepository({
    rootDirectory: "/logical-root",
    documents: root.forOrganization(orgB),
  }).listWorkspaces(), []);
});
