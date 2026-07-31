import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createOrganizationId } from "../../../../contracts/organization";
import { createInMemoryStructuredDocumentStore } from "../../shared";
import {
  assignLegacyStructuredDataToOrganization,
  inventoryLegacyStructuredData,
} from "../legacy-organization-assignment";

test("legacy assignment requires reviewed inventory, writes rollback source, and moves atomically", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "legacy-assignment-"));
  const documents = createInMemoryStructuredDocumentStore(() => "2026-07-16T12:00:00.000Z");
  const organizationId = createOrganizationId("org-a");
  try {
    await documents.writeDocument("workspaces", "index.json", [{ workspaceId: "workspace-a" }]);
    await documents.writeDocument("models", "models.json", [{ id: "model-a" }]);
    const inventory = await inventoryLegacyStructuredData(documents, ["workspaces", "models"]);
    assert.equal(inventory.totalDocumentCount, 2);

    const rollbackFilePath = path.join(root, "rollback.ndjson");
    await assignLegacyStructuredDataToOrganization({
      documents,
      organizationId,
      namespaces: ["workspaces", "models"],
      expectedFingerprint: inventory.fingerprint,
      rollbackFilePath,
      assignedAt: "2026-07-16T12:30:00.000Z",
    });

    assert.equal(await documents.readDocument("workspaces", "index.json"), undefined);
    assert.deepEqual(
      (await documents.forOrganization(organizationId).readDocument("workspaces", "index.json"))?.value,
      [{ workspaceId: "workspace-a" }],
    );
    const rollback = await readFile(rollbackFilePath, "utf8");
    assert.match(rollback, /legacy-organization-assignment-rollback/);
    assert.match(rollback, new RegExp(inventory.fingerprint.replace(":", "\\:")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy assignment rejects platform namespaces and stale confirmation", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  await documents.writeDocument("application-settings", "settings.json", {});
  await documents.writeDocument("workspaces", "index.json", []);
  await assert.rejects(
    () => inventoryLegacyStructuredData(documents, ["application-settings"]),
    /cannot be assigned/,
  );
  await assert.rejects(
    () => assignLegacyStructuredDataToOrganization({
      documents,
      organizationId: createOrganizationId("org-a"),
      namespaces: ["workspaces"],
      expectedFingerprint: "sha256:stale",
      rollbackFilePath: path.join(tmpdir(), "must-not-be-created.ndjson"),
    }),
    /inventory changed/,
  );
  assert.ok(await documents.readDocument("workspaces", "index.json"));
});
