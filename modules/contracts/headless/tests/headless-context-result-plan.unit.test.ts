import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {HEADLESS_CONTRACT_VERSION as version, isHeadlessHostIncarnationId} from "../headless-protocol";
import {readHeadlessContextResultSavePlanRequest, readHeadlessSavedContextReference,
  readHeadlessContextSavedRequest, readHeadlessContextSavedValue} from "../headless-context-result-plan";
import {parseHeadlessReadRequest} from "../headless-read-request";
import {parseHeadlessBuildPlanProposal} from "../headless-system-management";
import {readHeadlessPlanStepResult} from "../headless-plan-step-wire";
import {readDesktopPlanApprovalView} from "../desktop-headless-plan-approval";
import {readManagedBrowserPlanApprovalValue} from "../managed-browser-plan-approval";
import {createWorkspaceId} from "../../workspace";

const host = randomUUID(); assert.ok(isHeadlessHostIncarnationId(host));
const workspaceId = createWorkspaceId("workspace.synthetic.context-save"), taskId = randomUUID(), contextId = randomUUID();
const input = {hostIncarnationId: host, workspaceId, taskId, idempotencyKey: randomUUID(), reportFingerprint: "a".repeat(64), name: "Synthetic context"};
const wire = {version, operation: "context.save-result", input};
const {hostIncarnationId: _host, workspaceId: _workspace, ...fields} = input;
const proposal = {hostIncarnationId: host, workspaceId, steps: [{operation: wire.operation, ...fields}]};
const capabilities = {allowLocalFileSave: true, allowProviderFileSave: true, allowLocalDatasetPreparation: true,
  allowDatasetResultSave: true, allowContextPackGeneration: true, allowContextRagGeneration: true, allowContextResultSave: true};
const reference = {workspaceId, contextId, taskId, kind: "markdown-context-pack", artifactDigest: `sha256:${"b".repeat(64)}`};

test("Context save request is exact, distinct from generation, and rejects private paths or invented outputs", () => {
  assert.deepEqual(readHeadlessContextResultSavePlanRequest(wire, host), {ok: true, request: wire});
  const other = randomUUID(); assert.ok(isHeadlessHostIncarnationId(other));
  assert.deepEqual(readHeadlessContextResultSavePlanRequest(wire, other), {ok: false, code: "headless.host-changed"});
  for (const patch of [{path: "private/output.zip"}, {storageKey: "workspace/object"}, {contextId}, {output: {digest: reference.artifactDigest}},
    {modelId: "substitute"}, {taskId: "not-a-task"}, {reportFingerprint: "invalid"}, {name: "../private"}, {name: ""}, {name: " Synthetic "}])
    assert.equal(readHeadlessContextResultSavePlanRequest({...wire, input: {...input, ...patch}}, host).ok, false);
});

test("version8 approval binds exact reviewed save while old plan previews remain unchanged", () => {
  assert.equal(parseHeadlessBuildPlanProposal(proposal, host).ok, false);
  assert.equal(parseHeadlessBuildPlanProposal(proposal, host, {...capabilities, allowContextResultSave: false}).ok, false);
  const built = parseHeadlessBuildPlanProposal(proposal, host, capabilities); assert.ok(built.ok);
  assert.equal(built.preview.version, "aisb-build-plan-preview-v8");
  assert.deepEqual(built.preview.steps[0], {operation: wire.operation, input: fields, effect: "save-reviewed-context",
    externalProviderCalls: 0, modelCalls: 0, maximumArtifactBytes: 64 * 1024 * 1024, exactReviewRequired: true});
  assert.equal(parseHeadlessBuildPlanProposal({...proposal, steps: [...proposal.steps, {...proposal.steps[0], idempotencyKey: randomUUID()}]}, host, capabilities).ok, false);
  const source = {kind: "ingestion-file", taskId: "source.synthetic", fileId: "file.synthetic", taskRevision: 1};
  const pack = {operation: "context.generate-pack", idempotencyKey: randomUUID(), name: "Other context", sources: [source], settings: {
    kind: "markdown-context-pack", cleaningPreset: "standard", chunkCharacters: 500, overlapCharacters: 50, maximumChunks: 100, textFields: ["text"]}};
  const legacy = {...proposal, steps: [pack]};
  assert.deepEqual(parseHeadlessBuildPlanProposal(legacy, host, capabilities),
    parseHeadlessBuildPlanProposal(legacy, host, {...capabilities, allowContextResultSave: false}));
  const mixed = parseHeadlessBuildPlanProposal({...proposal, steps: [pack, ...proposal.steps]}, host, capabilities); assert.ok(mixed.ok);
  assert.equal(mixed.preview.version, "aisb-build-plan-preview-v8");
});

test("both approval codecs preserve Context saving permissions and reject altered limits or authority", () => {
  const built = parseHeadlessBuildPlanProposal(proposal, host, capabilities); assert.ok(built.ok);
  const selection = {workspaceId, fingerprint: "c".repeat(64), registeredClientId: randomUUID()};
  const value = {selection, viewId: randomUUID(), preview: built.preview,
    state: {fingerprint: selection.fingerprint, revision: 1, stepCount: 1, approvedSteps: 0, expiresAt: Date.now() + 60000, status: "pending"}};
  const managed = {operation: "open" as const, selection, document: {hostIncarnationId: host, workspaceId, windowId: randomUUID(), uiIncarnationId: randomUUID()}};
  assert.deepEqual(readDesktopPlanApprovalView(value, selection, capabilities), value);
  assert.deepEqual(readManagedBrowserPlanApprovalValue(managed, value, capabilities), value);
  for (const patch of [{effect: "generate-rag-database"}, {modelCalls: "required"}, {externalProviderCalls: "required"},
    {maximumArtifactBytes: 128 * 1024 * 1024}, {exactReviewRequired: false}]) {
    const changed = {...value, preview: {...built.preview, steps: [{...built.preview.steps[0], ...patch}]}};
    assert.equal(readDesktopPlanApprovalView(changed, selection, capabilities), undefined);
    assert.equal(readManagedBrowserPlanApprovalValue(managed, changed, capabilities), undefined);
  }
});

test("Context save receipts are opaque and cannot claim a started task or expose an ordinary storage key", () => {
  const exact = {hostIncarnationId: host, workspaceId, fingerprint: "d".repeat(64), approvalRevision: 2, step: 1};
  const value = {kind: "committed", operation: wire.operation, reference, fingerprint: exact.fingerprint,
    approvalRevision: 2, step: 1, expiresAt: Date.now() + 60000};
  assert.deepEqual(readHeadlessSavedContextReference(reference, workspaceId, taskId), reference);
  for (const kind of ["committed", "replayed"]) assert.deepEqual(readHeadlessPlanStepResult({ok: true, value: {...value, kind}}, exact, capabilities),
    {ok: true, value: {...value, kind}});
  assert.equal(readHeadlessPlanStepResult({ok: true, value}, exact).ok, false);
  for (const patch of [{kind: "started"}, {reference: {...reference, path: "private"}}, {reference: {...reference, storageKey: "ordinary"}},
    {reference: {...reference, workspaceId: "foreign"}}, {reference: {...reference, artifactDigest: "invalid"}}])
    assert.equal(readHeadlessPlanStepResult({ok: true, value: {...value, ...patch}}, exact, capabilities).ok, false);
});

test("saved Context reads are metadata only with exact scope, counts and explicit unchecked byte availability", () => {
  const read = {version, operation: "context.saved", input: {hostIncarnationId: host, workspaceId, contextId}};
  assert.deepEqual(readHeadlessContextSavedRequest(read, host), {ok: true, request: read});
  assert.deepEqual(parseHeadlessReadRequest(read, host), {ok: true, request: read});
  const value = {reference, name: input.name, sizeBytes: 3, sourceCount: 1, chunkCount: 1, byteAvailability: "not-checked"};
  assert.deepEqual(readHeadlessContextSavedValue(value, workspaceId, contextId), value);
  for (const patch of [{sourceCount: 5}, {chunkCount: 1001}, {byteAvailability: "ready"}, {sizeBytes: 0}, {path: "private"},
    {content: "raw source"}, {reference: {...reference, contextId: randomUUID()}}, {reference: {...reference, workspaceId: "foreign"}}])
    assert.equal(readHeadlessContextSavedValue({...value, ...patch}, workspaceId, contextId), undefined);
});
