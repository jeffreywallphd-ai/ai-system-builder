import assert from "node:assert/strict";
import test from "node:test";

import { createOrganizationId } from "../../../../contracts/organization";
import { createExpressOrganizationContextScope } from "../../../transport/api-express/security";
import { createInMemoryStructuredDocumentStore } from "../in-memory-structured-document-store";
import { createOrganizationContextStructuredDocumentStore } from "../organization-context-structured-document-store";

test("request-context document store fails closed and preserves async organization isolation", async () => {
  const root = createInMemoryStructuredDocumentStore();
  const scope = createExpressOrganizationContextScope();
  const documents = createOrganizationContextStructuredDocumentStore(root, scope);
  const orgA = createOrganizationId("org-a");
  const orgB = createOrganizationId("org-b");

  assert.throws(() => documents.readDocument("tests", "shared"), /context is required/);
  await scope.runWithOrganizationContext(
    { organizationId: orgA, principalId: "principal-a" },
    async () => {
      await Promise.resolve();
      await documents.writeDocument("tests", "shared", { owner: "a" });
      assert.equal((await documents.readDocument<{ owner: string }>("tests", "shared"))?.value.owner, "a");
      assert.throws(() => documents.forOrganization(orgB), /does not match/);
    },
  );
  await scope.runWithOrganizationContext(
    { organizationId: orgB, principalId: "principal-b" },
    async () => {
      assert.equal(await documents.readDocument("tests", "shared"), undefined);
      await documents.writeDocument("tests", "shared", { owner: "b" });
    },
  );
  assert.equal((await root.forOrganization(orgA).readDocument<{ owner: string }>("tests", "shared"))?.value.owner, "a");
  assert.equal((await root.forOrganization(orgB).readDocument<{ owner: string }>("tests", "shared"))?.value.owner, "b");
});
