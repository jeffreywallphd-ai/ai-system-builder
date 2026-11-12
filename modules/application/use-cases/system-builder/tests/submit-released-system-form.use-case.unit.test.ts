import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createStructuredSystemDataRepository } from "../../../../adapters/persistence/system-data";
import { createSha256SystemBuildHasher } from "../../../../adapters/storage/system-build";
import { normalizeSystemReleaseId } from "../../../../contracts/system-build";
import type { SystemDataPrincipal } from "../../../../contracts/system-data";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type { SystemDataResolvedDefinition } from "../../../ports/system-data";
import type { CompiledSystemFormAction } from "../../../services/system-builder/system-form-action.service";
import type { SystemFormField } from "../../../services/system-builder/system-form-rules.service";
import { ReleaseBoundSystemDataUseCases } from "../../system-data";
import { SubmitReleasedSystemFormUseCase } from "../submit-released-system-form.use-case";

const hasher = createSha256SystemBuildHasher();
const workspaceId = createWorkspaceId("workspace-form-submit");
const releaseDigest = hasher.digest("synthetic approved release");
const releaseId = normalizeSystemReleaseId(`system-release:${releaseDigest.slice(7)}`);
const identity = { actorId: "owner-a", authenticated: true, roles: ["owner"] } satisfies SystemDataPrincipal;
const formId = "form-a";
const submissionId = "9a37938e-de87-4a3d-b9ac-97828b96290f";
const field = (id: string, required = false): SystemFormField => ({ id, label: id, required, helpText: "", kind: "text", options: [],
  min: 0, max: 128, dateKind: "date", earliest: undefined, latest: undefined });
const action: CompiledSystemFormAction = {
  operationId: "create-a", entityType: "Request", mappings: [{ fieldId: "reason", recordField: "reason" }, { fieldId: "note", recordField: "note" }],
  form: { id: formId, title: "Request", steps: [
    { id: "start", label: "Start", fields: [field("reason", true), field("private")],
      defaultDestinationId: "detail", conditions: [{ fromStepId: "start", destinationId: formId, priority: 0,
        when: { fieldId: "reason", operator: "equals", value: "Simple request" } }] },
    { id: "detail", label: "Details", fields: [field("note")], defaultDestinationId: formId, conditions: [] },
  ] },
};
const definition: SystemDataResolvedDefinition = {
  descriptor: { schemaVersion: "1.0", targetWorkspaceId: workspaceId, releaseId, entityType: "Request", title: "Requests",
    fields: [{ name: "reason", label: "Reason", type: "text", required: true }, { name: "note", label: "Note", type: "text", required: false }], maximumPageSize: 20 },
  rolesByAction: { create: ["owner"], read: ["owner"], update: ["owner"], list: ["owner"] }, unmaskRoles: [],
};
const request = { workspaceId, releaseId, releaseDigest, formId, submissionId,
  answers: { reason: "Simple request", note: "skipped synthetic answer", private: "unmapped synthetic answer" } };

test("one transactional record and audit survive a lost response and replay with a fresh use case", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  const repository = createStructuredSystemDataRepository(documents);
  let effects = 0;
  let loseResponse = true;
  let loseRecoveryRead = true;
  const compose = () => {
    const runtime = new ReleaseBoundSystemDataUseCases({ definitions: { resolve: async () => definition }, generateAuditId: () => "audit.form",
      repository: { ...repository, readRecord: async (...args) => {
        if (loseRecoveryRead) { loseRecoveryRead = false; throw new Error("synthetic interrupted recovery read"); }
        return repository.readRecord(...args);
      }, createRecordWithAudit: async (record, audit) => {
        const saved = await repository.createRecordWithAudit(record, audit);
        effects++;
        if (loseResponse) { loseResponse = false; throw new Error("synthetic lost response after commit"); }
        return saved;
      } } });
    return new SubmitReleasedSystemFormUseCase({ hasher, release: { resolve: async () => action },
      records: { createOnce: (command) => runtime.createFormRecordOnce(command) } });
  };
  const authority = { actorId: identity.actorId, readPrincipal: async () => identity };
  const first = await compose().execute(request, authority);
  assert.equal(first.status, "pending");
  const [original] = await repository.listRecords(workspaceId, releaseId, "Request");
  assert.deepEqual(original?.values, { reason: "Simple request" });
  const editor = new ReleaseBoundSystemDataUseCases({ repository, definitions: { resolve: async () => definition }, generateAuditId: () => "audit.edit" });
  const edited = await editor.update({ workspaceId, releaseId, entityType: "Request", principal: identity, recordId: first.receiptId,
    expectedRevision: 1, values: { reason: "Edited request" } });
  assert.ok(edited.ok);
  assert.equal(Object.prototype.hasOwnProperty.call(edited.value, "creationSource"), false);
  const replay = await compose().execute(request, authority);
  assert.deepEqual(replay, { status: "already-recorded", receiptId: first.receiptId });
  assert.equal(effects, 1);
  const [record] = await repository.listRecords(workspaceId, releaseId, "Request");
  assert.deepEqual(record?.values, { reason: "Edited request" });
  const audit = await repository.listAudit(workspaceId, releaseId, "Request", 10);
  assert.equal(audit.length, 2);
  const creation = audit.filter((entry) => entry.action === "create");
  assert.equal(creation.length, 1);
  assert.deepEqual(creation[0]?.changedFields, ["reason"]);
  assert.doesNotMatch(JSON.stringify({ first, replay, audit }), /Simple request|Edited request|synthetic answer/);
  const changed = await compose().execute({ ...request, answers: { reason: "Changed request" } }, authority);
  assert.deepEqual(changed, replay);
  assert.equal(effects, 1);
});

test("rechecks current action permission after validation and denies changed scope without writes", async () => {
  const repository = createStructuredSystemDataRepository(createInMemoryStructuredDocumentStore());
  const runtime = new ReleaseBoundSystemDataUseCases({ repository, definitions: { resolve: async () => definition }, generateAuditId: () => "audit.denied" });
  const compose = (resolve: () => Promise<CompiledSystemFormAction | undefined>) => new SubmitReleasedSystemFormUseCase({ hasher, release: { resolve },
    records: { createOnce: (command) => runtime.createFormRecordOnce(command) } });
  let reads = 0;
  const denied = await compose(async () => action).execute(request, { actorId: identity.actorId,
    readPrincipal: async () => ++reads === 1 ? identity : { ...identity, roles: ["viewer"] } });
  assert.deepEqual(denied, { status: "denied" });
  assert.equal(reads, 2);
  let releaseReads = 0;
  const unavailable = await compose(async () => ++releaseReads === 1 ? action : undefined).execute(request,
    { actorId: identity.actorId, readPrincipal: async () => identity });
  assert.deepEqual(unavailable, { status: "denied" });
  assert.equal((await repository.listRecords(workspaceId, releaseId, "Request")).length, 0);
});

test("an ordinary record with the same identity is not treated as a form receipt", async () => {
  const repository = createStructuredSystemDataRepository(createInMemoryStructuredDocumentStore());
  const runtime = new ReleaseBoundSystemDataUseCases({ repository, definitions: { resolve: async () => definition }, generateAuditId: () => "audit.ordinary" });
  const recordId = `form-${"a".repeat(64)}`;
  const ordinary = await runtime.create({ workspaceId, releaseId, entityType: "Request", principal: identity,
    recordId, values: { reason: "Ordinary record" } });
  assert.ok(ordinary.ok);
  assert.equal(await runtime.createFormRecordOnce({ workspaceId, releaseId, entityType: "Request", formId,
    actorId: identity.actorId, recordId, values: { reason: "Ordinary record" }, reauthorize: async () => identity }), "pending");
  assert.equal((await repository.listAudit(workspaceId, releaseId, "Request", 10)).length, 1);
});

test("rejects malformed, unknown, missing and oversized answers before reaching the record action", async () => {
  let writes = 0;
  const useCase = new SubmitReleasedSystemFormUseCase({ hasher, release: { resolve: async () => action },
    records: { createOnce: async () => { writes++; return "completed"; } } });
  const authority = { actorId: identity.actorId, readPrincipal: async () => identity };
  for (const answers of [{ reason: "x".repeat(4001) }, { reason: "hello", foreign: true }, { "invalid/field": true }, { reason: 42 }, {}]) {
    assert.equal((await useCase.execute({ ...request, answers }, authority)).status, "invalid");
  }
  let accesses = 0;
  const accessor = Object.defineProperty({}, "reason", { enumerable: true, get() { accesses++; return "not data"; } });
  assert.deepEqual(await useCase.execute({ ...request, answers: accessor }, authority), { status: "invalid" });
  assert.equal(accesses, 0);
  assert.equal(writes, 0);
});
