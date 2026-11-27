import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import test from "node:test";
import {createWorkspaceId} from "../../workspace";
import {createOrganizationId} from "../../organization";
import {createInMemoryStructuredDocumentStore} from "../../../adapters/persistence/shared";
import {createStructuredHeadlessPlanReviewRepository} from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import {validateHeadlessPlanSavedSources} from "../../../hosts/shared/composition/headlessPlanReview";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, parseHeadlessBuildPlanProposal,
  parseHeadlessReadRequest, readDesktopPlanApprovalView, readHeadlessPlanReviewAgentRequest,
  readManagedBrowserPlanApprovalValue, readHeadlessPlanStepResult} from "..";

function fixture() {
  const host = randomUUID(); assert.ok(isHeadlessHostIncarnationId(host));
  const workspaceId = createWorkspaceId("workspace.training-approval");
  const step = {operation: "models.train", idempotencyKey: randomUUID(), name: "Support training trial",
    model: {modelRecordId: "model.synthetic", updatedAt: "2026-11-21T00:00:00.000Z"},
    dataset: {datasetId: "dataset.synthetic", versionId: "version.synthetic", versionDigest: "sha256:" + "a".repeat(64)},
    training: {trainingTask: "llm-instruction", method: "lora", commonParameters: {maxSteps: 8, seed: 0, weightDecay: 0},
      advancedParameters: {gradientCheckpointing: false}, validation: {enabled: false}}};
  const proposal = {hostIncarnationId: host, workspaceId, steps: [step]};
  const caps = {allowLocalFileSave: false, allowModelTraining: true};
  const parsed = parseHeadlessBuildPlanProposal(proposal, host, caps); assert.ok(parsed.ok);
  const fingerprint = createHash("sha256").update(JSON.stringify(parsed.preview)).digest("hex");
  const selection = {workspaceId, fingerprint, registeredClientId: randomUUID()};
  const packet = {selection, viewId: randomUUID(), preview: parsed.preview, state: {fingerprint, revision: 1,
    stepCount: 1, approvedSteps: 0, expiresAt: Date.now() + 60000, status: "pending" as const}};
  const managed = {operation: "open" as const, selection,
    document: {hostIncarnationId: host, workspaceId, windowId: randomUUID(), uiIncarnationId: randomUUID()}};
  return {host, step, proposal, caps, parsed, fingerprint, selection, packet, managed};
}

test("trusted opt-in projects exact saved inputs and settings with no runtime or Save authority", () => {
  const f = fixture();
  assert.equal(f.parsed.preview.version, "aisb-build-plan-preview-v13");
  const {operation, ...input} = f.step;
  assert.deepEqual(f.parsed.preview.steps, [{operation, input, effect: "train-local-model", externalProviderCalls: 0,
    modelCalls: "required", loadsModel: true, writesModelRegistry: false, explicitSaveRequired: true,
    runtimeReadiness: "not-checked", resourceAdmission: "not-checked"}]);
  assert.deepEqual(f.parsed.requests[0].input, {...input, hostIncarnationId: f.host, workspaceId: f.proposal.workspaceId});
  f.step.training.commonParameters.seed = 3;
  const projected = f.parsed.preview.steps[0]; assert.equal(projected.operation, "models.train");
  if (projected.operation !== "models.train") throw new Error("Missing training preview");
  assert.equal(projected.input.training.commonParameters.seed, 0);
});

test("training never enters default plans, public reads, or JSON-supplied capability flags", () => {
  const f = fixture();
  assert.equal(parseHeadlessBuildPlanProposal(f.proposal, f.host).ok, false);
  for (const caps of [{allowLocalFileSave: true}, {...f.caps, allowModelTraining: false}])
    assert.equal(parseHeadlessBuildPlanProposal(f.proposal, f.host, caps).ok, false);
  assert.equal(parseHeadlessBuildPlanProposal({...f.proposal, allowModelTraining: true}, f.host, f.caps).ok, false);
  assert.equal(parseHeadlessBuildPlanProposal({...f.proposal, steps: [{...f.step, approved: true}]}, f.host, f.caps).ok, false);
  assert.equal(parseHeadlessReadRequest(f.parsed.requests[0], f.host).ok, false);
  assert.equal(readDesktopPlanApprovalView(f.packet, f.selection), undefined);
  assert.equal(readManagedBrowserPlanApprovalValue(f.managed, f.packet), undefined);
});

test("both channels reconstruct the exact preview and reject widened, missing or false effect claims", () => {
  const f = fixture();
  const expected = {selection: f.selection, viewId: f.packet.viewId, preview: f.parsed.preview, state: f.packet.state};
  assert.deepEqual(readDesktopPlanApprovalView(f.packet, f.selection, f.caps), expected);
  assert.deepEqual(readManagedBrowserPlanApprovalValue(f.managed, f.packet, f.caps), expected);
  for (const patch of [{modelCalls: 0}, {loadsModel: false}, {writesModelRegistry: true}, {explicitSaveRequired: false},
    {runtimeReadiness: "ready"}, {resourceAdmission: "passed"}, {effect: "saved-system-write"}, {externalProviderCalls: "required"},
    {maximumTotalBytes: 1}, {approved: true}]) {
    const packet = {...f.packet, preview: {...f.packet.preview, steps: [{...f.packet.preview.steps[0], ...patch}]}};
    assert.equal(readDesktopPlanApprovalView(packet, f.selection, f.caps), undefined, JSON.stringify(patch));
    assert.equal(readManagedBrowserPlanApprovalValue(f.managed, packet, f.caps), undefined);
  }
  for (const field of ["resourceAdmission", "modelCalls", "explicitSaveRequired"]) {
    const step: Record<string, unknown> = {...f.packet.preview.steps[0]}; delete step[field];
    assert.equal(readDesktopPlanApprovalView({...f.packet, preview: {...f.packet.preview, steps: [step]}}, f.selection, f.caps), undefined);
  }
  assert.equal(readDesktopPlanApprovalView({...f.packet, preview: {...f.packet.preview, version: "aisb-build-plan-preview-v12"}}, f.selection, f.caps), undefined);
});

test("the review wire forwards only trusted opt-in and preserves exact fingerprint binding data", () => {
  const f = fixture(), request = {version: HEADLESS_CONTRACT_VERSION, operation: "plan.submit",
    input: {...f.proposal, fingerprint: f.fingerprint}};
  assert.equal(readHeadlessPlanReviewAgentRequest(request, f.host).ok, false);
  const accepted = readHeadlessPlanReviewAgentRequest(request, f.host, f.caps); assert.ok(accepted.ok);
  assert.equal(accepted.request.operation, "plan.submit");
  if (accepted.request.operation !== "plan.submit") throw new Error("Missing proposal");
  assert.deepEqual(accepted.request.proposal, f.parsed);
  assert.equal(readHeadlessPlanReviewAgentRequest({...request, input: {...request.input, allowModelTraining: true}}, f.host, f.caps).ok, false);
});

test("every saved input and setting change changes the canonical preview fingerprint", () => {
  const f = fixture();
  for (const patch of [{name: "Another trial"}, {model: {...f.step.model, updatedAt: "2026-11-22T00:00:00.000Z"}},
    {dataset: {...f.step.dataset, versionDigest: "sha256:" + "b".repeat(64)}},
    {training: {...f.step.training, commonParameters: {...f.step.training.commonParameters, seed: 1}}},
    {training: {...f.step.training, advancedParameters: {gradientCheckpointing: true}}},
    {training: {...f.step.training, validation: {enabled: true}}}]) {
    const changed = parseHeadlessBuildPlanProposal({...f.proposal, steps: [{...f.step, ...patch}]}, f.host, f.caps); assert.ok(changed.ok);
    assert.notEqual(createHash("sha256").update(JSON.stringify(changed.preview)).digest("hex"), f.fingerprint);
  }
});

test("mixed training/system previews retain order while ordinary plans retain their exact v1 bytes", () => {
  const f = fixture(), system = {operation: "systems.create", idempotencyKey: randomUUID(), name: "Support assistant",
    templateId: "reference.secured-data-review@1.0.0"};
  const ordinary = {...f.proposal, steps: [system]};
  assert.deepEqual(parseHeadlessBuildPlanProposal(ordinary, f.host, f.caps), parseHeadlessBuildPlanProposal(ordinary, f.host));
  const mixed = parseHeadlessBuildPlanProposal({...f.proposal, steps: [system, f.step]}, f.host, f.caps); assert.ok(mixed.ok);
  assert.deepEqual(mixed.preview.steps.map(step => step.operation), ["systems.create", "models.train"]);
  assert.equal(mixed.preview.version, "aisb-build-plan-preview-v13");
  assert.equal(parseHeadlessBuildPlanProposal({...f.proposal, steps: [f.step, f.step]}, f.host, f.caps).ok, false);
});

test("active, hidden, cyclic and malformed settings fail without executing getters", () => {
  const f = fixture(); let reads = 0;
  const active = {...f.step}; Object.defineProperty(active, "training", {enumerable: true, get() {reads++; return f.step.training;}});
  const hidden = {...f.step}; Object.defineProperty(hidden, "allowModelTraining", {value: true});
  const cyclic: Record<string, unknown> = {...f.step}; cyclic.training = cyclic;
  for (const step of [active, hidden, cyclic, {...f.step, training: {commonParameters: {maxSteps: "8"}}},
    {...f.step, model: {...f.step.model, localPath: "private"}}, {...f.step, dataset: {...f.step.dataset, versionDigest: "bad"}}])
    assert.equal(parseHeadlessBuildPlanProposal({...f.proposal, steps: [step]}, f.host, f.caps).ok, false);
  assert.equal(reads, 0);
});

test("unconfigured real storage and saved-source host validation deny without invoking authorization or file validators", async () => {
  const f = fixture(), documents = createInMemoryStructuredDocumentStore();
  let authorizations = 0, validations = 0;
  const repository = createStructuredHeadlessPlanReviewRepository(documents, async () => {authorizations++; return true;});
  const scope = {workspaceId: f.proposal.workspaceId, organizationId: createOrganizationId("organization.training-approval"),
    principalId: "principal.synthetic", registeredClientId: f.selection.registeredClientId};
  assert.deepEqual(await repository.propose({target: {hostIncarnationId: f.host, scope, fingerprint: f.fingerprint},
    proposal: f.proposal, isCurrent: () => true}), {ok: false, code: "invalid"});
  assert.equal(await validateHeadlessPlanSavedSources(documents, scope.workspaceId, f.parsed.requests,
    () => true, async () => {validations++; return true;}), false);
  assert.equal(authorizations, 0); assert.equal(validations, 0);
});

function saveFixture() {
  const f = fixture(), step = {operation: "models.save-training", idempotencyKey: randomUUID(), name: "Token classifier",
    taskId: randomUUID(), candidateDigest: "sha256:" + "d".repeat(64)};
  const caps = {allowLocalFileSave: false, allowModelTrainingSave: true};
  const proposal = {...f.proposal, steps: [step]}, parsed = parseHeadlessBuildPlanProposal(proposal, f.host, caps); assert.ok(parsed.ok);
  const fingerprint = createHash("sha256").update(JSON.stringify(parsed.preview)).digest("hex");
  const selection = {...f.selection, fingerprint};
  const packet = {...f.packet, selection, preview: parsed.preview, state: {...f.packet.state, fingerprint}};
  const managed = {...f.managed, selection};
  return {...f, step, caps, proposal, parsed, fingerprint, selection, packet, managed};
}

test("trained Save is a separate exact opted-in proposal with truthful copy/registry effects", () => {
  const f = saveFixture(), {operation, ...input} = f.step;
  assert.equal(f.parsed.preview.version, "aisb-build-plan-preview-v14");
  assert.deepEqual(f.parsed.preview.steps, [{operation, input, effect: "save-reviewed-trained-model", externalProviderCalls: 0,
    modelCalls: 0, loadsModel: false, writesModelRegistry: true, storageAuthority: "bounded-local-copy",
    runtimeReadiness: "not-checked", exactReviewRequired: true}]);
  assert.equal(parseHeadlessBuildPlanProposal(f.proposal, f.host).ok, false);
  for (const caps of [{allowLocalFileSave: true}, fixture().caps,
    {...f.caps, allowModelTrainingSave: false}, {allowLocalFileSave: false, allowModelReferenceSave: true}])
    assert.equal(parseHeadlessBuildPlanProposal(f.proposal, f.host, caps).ok, false);
  for (const change of [{taskId: randomUUID()}, {candidateDigest: "sha256:" + "e".repeat(64)},
    {name: "Another trained model"}, {idempotencyKey: randomUUID()}]) {
    const changed = parseHeadlessBuildPlanProposal({...f.proposal, steps: [{...f.step, ...change}]}, f.host, f.caps); assert.ok(changed.ok);
    assert.notEqual(createHash("sha256").update(JSON.stringify(changed.preview)).digest("hex"), f.fingerprint);
  }
  const submit = {version: HEADLESS_CONTRACT_VERSION, operation: "plan.submit", input: {...f.proposal, fingerprint: f.fingerprint}};
  assert.equal(readHeadlessPlanReviewAgentRequest(submit, f.host).ok, false);
  const decoded = readHeadlessPlanReviewAgentRequest(submit, f.host, f.caps); assert.ok(decoded.ok && decoded.request.operation === "plan.submit");
  assert.deepEqual(decoded.request.proposal, f.parsed);
  f.step.name = "Changed later";
  assert.equal(f.parsed.preview.steps[0].input.name, "Token classifier");
});

test("trained Save views reconstruct exact permissions on both channels and deny tampering", () => {
  const f = saveFixture(), expected = {selection: f.selection, viewId: f.packet.viewId, preview: f.parsed.preview, state: f.packet.state};
  assert.deepEqual(readDesktopPlanApprovalView(f.packet, f.selection, f.caps), expected);
  assert.deepEqual(readManagedBrowserPlanApprovalValue(f.managed, f.packet, f.caps), expected);
  assert.equal(readDesktopPlanApprovalView(f.packet, f.selection, fixture().caps), undefined);
  for (const patch of [{modelCalls: "required"}, {loadsModel: true}, {writesModelRegistry: false}, {storageAuthority: "reference-only"},
    {storageAuthority: "protected-service"}, {runtimeReadiness: "ready"}, {exactReviewRequired: false}, {externalProviderCalls: "required"},
    {effect: "save-reviewed-model-reference"}, {maximumTotalBytes: 1}, {approved: true}]) {
    const packet = {...f.packet, preview: {...f.packet.preview, steps: [{...f.packet.preview.steps[0], ...patch}]}};
    assert.equal(readDesktopPlanApprovalView(packet, f.selection, f.caps), undefined);
    assert.equal(readManagedBrowserPlanApprovalValue(f.managed, packet, f.caps), undefined);
  }
  for (const field of ["storageAuthority", "modelCalls", "exactReviewRequired"]) {
    const step: Record<string, unknown> = {...f.packet.preview.steps[0]}; delete step[field];
    assert.equal(readDesktopPlanApprovalView({...f.packet, preview: {...f.packet.preview, steps: [step]}}, f.selection, f.caps), undefined);
  }
  assert.equal(readDesktopPlanApprovalView({...f.packet, preview: {...f.packet.preview, version: "aisb-build-plan-preview-v13"}}, f.selection, f.caps), undefined);
});

test("trained Save input stays closed and cannot assert consent, paths or future training results", () => {
  const f = saveFixture(); let reads = 0;
  const active = {...f.step}; Object.defineProperty(active, "candidateDigest", {enumerable: true, get() {reads++; return f.step.candidateDigest;}});
  for (const step of [active, {...f.step, approved: true}, {...f.step, allowModelTrainingSave: true}, {...f.step, localPath: "private"},
    {...f.step, taskId: "later-step"}, {...f.step, candidateDigest: "unknown"}, {...f.step, storageProfile: "protected-service"}])
    assert.equal(parseHeadlessBuildPlanProposal({...f.proposal, steps: [step]}, f.host, f.caps).ok, false);
  assert.equal(reads, 0);
  assert.equal(parseHeadlessBuildPlanProposal({...f.proposal, allowModelTrainingSave: true}, f.host, f.caps).ok, false);
  assert.equal(parseHeadlessBuildPlanProposal({...f.proposal, steps: [f.step, {...f.step, idempotencyKey: randomUUID()}]}, f.host, f.caps).ok, false);
  const old = fixture(), caps = {...old.caps, ...f.caps};
  assert.deepEqual(parseHeadlessBuildPlanProposal(old.proposal, old.host, caps), old.parsed, "Old training preview bytes remain unchanged.");
  const mixed = parseHeadlessBuildPlanProposal({...f.proposal, steps: [old.step, f.step]}, f.host, caps); assert.ok(mixed.ok);
  assert.deepEqual(mixed.preview.steps.map(s => s.operation), ["models.train", "models.save-training"]);
});

test("trained Save replies are path-free, correlated and cannot claim runtime readiness or foreign authority", () => {
  const f = saveFixture(), target = {...f.proposal, fingerprint: f.fingerprint, approvalRevision: 1, step: 1};
  const reference = {workspaceId: f.proposal.workspaceId, modelRecordId: "model_headless_trained_" + "a".repeat(32),
    taskId: f.step.taskId, candidateDigest: f.step.candidateDigest, storageProfile: "bounded-local-v1", runtimeReadiness: "not-checked"};
  const value = {kind: "committed", operation: "models.save-training", fingerprint: f.fingerprint, approvalRevision: 1, step: 1,
    expiresAt: Date.now() + 60000, reference};
  assert.deepEqual(readHeadlessPlanStepResult({ok: true, value}, target, f.caps), {ok: true, value});
  assert.equal(readHeadlessPlanStepResult({ok: true, value}, target).ok, false);
  for (const patch of [{workspaceId: createWorkspaceId("workspace.foreign")}, {localPath: "private"}, {runtimeReadiness: "ready"},
    {modelRecordId: "model_headless_" + "a".repeat(32)}, {storageProfile: "protected-service"}, {candidateDigest: "unknown"}])
    assert.equal(readHeadlessPlanStepResult({ok: true, value: {...value, reference: {...reference, ...patch}}}, target, f.caps).ok, false);
  for (const patch of [{kind: "started"}, {approvalRevision: 2}, {fingerprint: "b".repeat(64)}, {step: 2}])
    assert.equal(readHeadlessPlanStepResult({ok: true, value: {...value, ...patch}}, target, f.caps).ok, false);
});

test("unconfigured trained Save proposal cannot reach generic storage or source validation", async () => {
  const f = saveFixture(), documents = createInMemoryStructuredDocumentStore(); let authorizations = 0, validations = 0;
  const repository = createStructuredHeadlessPlanReviewRepository(documents, async () => {authorizations++; return true;});
  const scope = {workspaceId: f.proposal.workspaceId, organizationId: createOrganizationId("organization.training-approval"),
    principalId: "principal.synthetic", registeredClientId: f.selection.registeredClientId};
  assert.deepEqual(await repository.propose({target: {hostIncarnationId: f.host, scope, fingerprint: f.fingerprint},
    proposal: f.proposal, isCurrent: () => true}), {ok: false, code: "invalid"});
  assert.equal(await validateHeadlessPlanSavedSources(documents, scope.workspaceId, f.parsed.requests,
    () => true, async () => {validations++; return true;}), false);
  assert.equal(authorizations, 0); assert.equal(validations, 0);
});
