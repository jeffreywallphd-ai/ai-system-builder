import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createExpressOrganizationContextScope } from "../../../../transport/api-express/security";
import { createOrganizationId } from "../../../../../contracts/organization";
import {
  createRetrieveArtifactRequest,
  createStoreArtifactRequest,
} from "../../../../../contracts/storage";
import { createFilesystemArtifactObjectStorageAdapter } from "..";

test("filesystem object storage keeps one logical key in separate organization prefixes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "organization-object-storage-"));
  const contexts = createExpressOrganizationContextScope();
  const storage = createFilesystemArtifactObjectStorageAdapter({
    rootDirectory: root,
    organizationContextProvider: contexts,
  });
  const orgA = createOrganizationId("org-a");
  const orgB = createOrganizationId("org-b");
  const key = "workspaces/workspace-a/artifacts/files/shared.txt";
  try {
    const missingContext = await storage.storeArtifact(
      createStoreArtifactRequest(new Uint8Array([0]), { descriptor: { key } }),
    );
    assert.equal(missingContext.ok, false);
    await contexts.runWithOrganizationContext(
      { organizationId: orgA, principalId: "principal-a" },
      async () => {
        const result = await storage.storeArtifact(
          createStoreArtifactRequest(new Uint8Array([65]), { descriptor: { key } }),
        );
        assert.equal(result.ok, true);
      },
    );
    await contexts.runWithOrganizationContext(
      { organizationId: orgB, principalId: "principal-b" },
      async () => {
        const missing = await storage.retrieveArtifact(createRetrieveArtifactRequest(key));
        assert.equal(missing.ok, false);
        await storage.storeArtifact(
          createStoreArtifactRequest(new Uint8Array([66]), { descriptor: { key } }),
        );
      },
    );
    assert.deepEqual(
      new Uint8Array(await readFile(path.join(root, "organizations", orgA, key))),
      new Uint8Array([65]),
    );
    assert.deepEqual(
      new Uint8Array(await readFile(path.join(root, "organizations", orgB, key))),
      new Uint8Array([66]),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
