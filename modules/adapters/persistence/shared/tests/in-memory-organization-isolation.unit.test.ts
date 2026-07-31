import assert from "node:assert/strict";
import test from "node:test";

import { createOrganizationId } from "../../../../contracts/organization";
import { createInMemoryStructuredDocumentStore } from "../in-memory-structured-document-store";

test("in-memory structured documents isolate identical keys by organization", async () => {
  const root = createInMemoryStructuredDocumentStore(() => "2026-07-16T12:00:00.000Z");
  const orgA = root.forOrganization(createOrganizationId("org-a"));
  const orgB = root.forOrganization(createOrganizationId("org-b"));

  await root.writeDocument("settings", "shared", { owner: "platform" });
  await orgA.writeDocument("settings", "shared", { owner: "a" });
  await orgB.writeDocument("settings", "shared", { owner: "b" });

  assert.equal((await root.readDocument<{ owner: string }>("settings", "shared"))?.value.owner, "platform");
  assert.equal((await orgA.readDocument<{ owner: string }>("settings", "shared"))?.value.owner, "a");
  assert.equal((await orgB.readDocument<{ owner: string }>("settings", "shared"))?.value.owner, "b");
  assert.deepEqual(await orgA.listNamespaces(), ["settings"]);
  assert.throws(
    () => orgA.forOrganization(createOrganizationId("org-b")),
    /cannot change organization scope/,
  );
});

test("organization-scoped in-memory transactions preserve scope and roll back atomically", async () => {
  const root = createInMemoryStructuredDocumentStore();
  const org = root.forOrganization(createOrganizationId("org-a"));

  await assert.rejects(
    () => org.runInTransaction(async (transaction) => {
      assert.equal(transaction.organizationId, org.organizationId);
      await transaction.writeDocument("tests", "rolled-back", { value: true });
      throw new Error("rollback");
    }),
    /rollback/,
  );
  assert.equal(await org.readDocument("tests", "rolled-back"), undefined);
});
