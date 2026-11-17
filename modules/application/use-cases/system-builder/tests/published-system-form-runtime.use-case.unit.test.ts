import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSystemReleaseId } from "../../../../contracts/system-build";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type { SystemDataPrincipal } from "../../../../contracts/system-data";
import type { SystemDataResolvedDefinition } from "../../../ports/system-data";
import type { CompiledSystemFormAction } from "../../../services/system-builder/system-form-action.service";
import { PublishedSystemFormRuntime } from "../published-system-form-runtime.use-case";

const workspaceId = createWorkspaceId("workspace-form-runtime");
const releaseId = normalizeSystemReleaseId(`system-release:${"b".repeat(64)}`);
const input = { workspaceId, releaseId };
const owner = { actorId: "owner-a", authenticated: true, roles: ["owner"] } satisfies SystemDataPrincipal;
const authority = { actorId: owner.actorId, readPrincipal: async () => owner };
const action = (id: string): CompiledSystemFormAction => ({
  form: { id, title: id, steps: [{ id: `${id}.first`, label: "First step", fields: [], conditions: [], defaultDestinationId: id }] },
  operationId: "create-a", entityType: "Request", mappings: [{ fieldId: "reason", recordField: "private-field-key" }],
});
const policy: SystemDataResolvedDefinition = {
  descriptor: { schemaVersion: "1.0", targetWorkspaceId: workspaceId, releaseId, entityType: "Request", title: "Requests", fields: [], maximumPageSize: 20 },
  rolesByAction: { create: ["owner"], read: ["owner"], update: ["owner"], list: ["owner"] }, unmaskRoles: [],
};

test("published forms list only current eligible descriptors and omit action mappings", async () => {
  const policies: string[] = [];
  let unavailable: string | undefined;
  const runtime = new PublishedSystemFormRuntime({
    releases: { list: async (selection) => {
      assert.deepEqual(selection, { workspaceId, releaseId, releaseDigest: `sha256:${"b".repeat(64)}` });
      return [action("intake"), action("questionnaire")];
    } },
    records: { resolve: async (_workspace, _release, _entity, options) => {
      assert.ok(options);
      policies.push(options.formInstanceId);
      return options.formInstanceId === unavailable ? undefined : policy;
    } },
    submissions: { execute: async () => ({ status: "denied" }) },
  });
  const result = await runtime.list(input, authority);
  assert.ok(result.ok);
  assert.deepEqual(result.value.map((form) => form.id), ["intake", "questionnaire"]);
  assert.deepEqual(policies, ["intake", "questionnaire"]);
  assert.doesNotMatch(JSON.stringify(result), /private-field-key|create-a/);
  for (const missing of ["questionnaire", "intake"]) {
    unavailable = missing;
    const available = await runtime.list(input, authority);
    assert.ok(available.ok);
    assert.deepEqual(available.value.map((form) => form.id), [missing === "intake" ? "questionnaire" : "intake"]);
  }
  let calls = 0;
  const denied = await runtime.list(input, { actorId: owner.actorId, readPrincipal: async () => ++calls === 1 ? owner : { ...owner, roles: ["member"] } });
  assert.deepEqual(denied, { ok: true, value: [] });
  const anonymous = await runtime.list(input, { actorId: owner.actorId, readPrincipal: async () => undefined });
  assert.equal(anonymous.ok, false);
  assert.equal(policies.length, 8);
});

test("the published submission facade normalizes only the content-addressed release and exact form identity", async () => {
  let calls = 0;
  const runtime = new PublishedSystemFormRuntime({ releases: { list: async () => [] }, records: { resolve: async () => undefined },
    submissions: { execute: async (request, suppliedAuthority) => {
      calls++;
      assert.equal(request.formId, "intake");
      assert.equal(suppliedAuthority, authority);
      return { status: "already-recorded", receiptId: "form-receipt" };
    } } });
  const request = { ...input, formId: "intake", submissionId: "synthetic", answers: {} };
  assert.deepEqual(await runtime.submit(request, authority), { ok: true, value: { status: "already-recorded", receiptId: "form-receipt" } });
  assert.equal((await runtime.submit({ ...request, releaseId: "legacy-id" }, authority)).ok, false);
  assert.equal((await runtime.submit({ ...request, formId: " intake " }, authority)).ok, true);
  assert.equal(calls, 1);
});
