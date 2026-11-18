import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {readHeadlessContextPackPlanRequest, readHeadlessContextGenerationPlanRequest} from "../headless-context-plan";
import {HEADLESS_CONTRACT_VERSION as version, type HeadlessHostIncarnationId} from "../headless-protocol";
import {createWorkspaceId} from "../../workspace";
import {parseHeadlessBuildPlanProposal} from "../headless-system-management";
import {readDesktopPlanApprovalView} from "../desktop-headless-plan-approval";
import {readManagedBrowserPlanApprovalValue} from "../managed-browser-plan-approval";
import {readHeadlessPlanStepResult} from "../headless-plan-step-wire";

const host = "ca353bdd-7793-44c6-8c36-c470be8c537c" as HeadlessHostIncarnationId;
const input = {hostIncarnationId: host, workspaceId: createWorkspaceId("workspace.context-plan"),
  idempotencyKey: "da914265-c9bb-4cc0-8ccb-35e4a0ad283d", name: "Synthetic context",
  sources: [{kind: "ingestion-file", taskId: "task.synthetic", fileId: "file.synthetic", taskRevision: 1}],
  settings: {kind: "markdown-context-pack", cleaningPreset: "standard", chunkCharacters: 500,
    overlapCharacters: 50, maximumChunks: 100, textFields: ["text"]}};
const wire = {version, operation: "context.generate-pack", input};
const {hostIncarnationId: _host, workspaceId: _workspace, ...fields} = input;
const proposal = {hostIncarnationId: host, workspaceId: input.workspaceId, steps: [{operation: wire.operation, ...fields}]};
const capabilities = {allowLocalFileSave: true, allowProviderFileSave: true, allowLocalDatasetPreparation: true,
  allowDatasetResultSave: true, allowContextPackGeneration: true};

test("Context pack proposal snapshots exact saved source settings without a task or model execution claim", () => {
  const decoded = readHeadlessContextPackPlanRequest(wire, host);
  assert.deepEqual(decoded, {ok: true, request: wire}); assert.ok(decoded.ok);
  assert.notEqual(decoded.request.input.sources, input.sources);
  assert.notEqual(decoded.request.input.settings.textFields, input.settings.textFields);
  assert.deepEqual(readHeadlessContextPackPlanRequest(wire, "ab353bdd-7793-44c6-8c36-c470be8c537c" as HeadlessHostIncarnationId),
    {ok: false, code: "headless.host-changed"});
});

test("Context v6 plans require explicit support and bind exact no-model processing limits", () => {
  assert.equal(parseHeadlessBuildPlanProposal(proposal, host).ok, false);
  assert.equal(parseHeadlessBuildPlanProposal(proposal, host, {...capabilities, allowContextPackGeneration: false}).ok, false);
  const built = parseHeadlessBuildPlanProposal(proposal, host, capabilities); assert.ok(built.ok);
  assert.equal(built.preview.version, "aisb-build-plan-preview-v6");
  assert.deepEqual(built.preview.steps[0], {operation: wire.operation, input: fields, effect: "generate-context-pack",
    modelCalls: 0, externalProviderCalls: 0, maximumSources: 4, maximumSourceBytes: 4 * 1024 * 1024,
    maximumTotalBytes: 16 * 1024 * 1024, maximumChunks: 1000, reviewRequired: true, explicitSaveRequired: true});
  const save = {operation: "data.save-local-source", idempotencyKey: randomUUID(),
    taskId: input.sources[0].taskId, fileId: input.sources[0].fileId, taskRevision: 1};
  for (const steps of [[save, ...proposal.steps], [...proposal.steps, save]])
    assert.equal(parseHeadlessBuildPlanProposal({...proposal, steps}, host, capabilities).ok, false);
});

test("both approval channels reconstruct exact Context permissions and reject changed or missing limits", () => {
  const built = parseHeadlessBuildPlanProposal(proposal, host, capabilities); assert.ok(built.ok);
  const selection = {workspaceId: input.workspaceId, fingerprint: "a".repeat(64), registeredClientId: randomUUID()};
  const value = {selection, viewId: randomUUID(), preview: built.preview,
    state: {fingerprint: selection.fingerprint, revision: 1, stepCount: 1, approvedSteps: 0,
      expiresAt: Date.now() + 60000, status: "pending"}};
  assert.deepEqual(readDesktopPlanApprovalView(value, selection, capabilities), value);
  assert.deepEqual(readDesktopPlanApprovalView(value, selection), value);
  assert.equal(readDesktopPlanApprovalView(value, selection, {...capabilities, allowContextPackGeneration: false}), undefined);
  const request = {operation: "open" as const, selection, document: {hostIncarnationId: host,
    workspaceId: input.workspaceId, windowId: randomUUID(), uiIncarnationId: randomUUID()}};
  assert.deepEqual(readManagedBrowserPlanApprovalValue(request, value, capabilities), value);
  assert.equal(readManagedBrowserPlanApprovalValue(request, value), undefined);
  for (const changed of [{modelCalls: 1}, {externalProviderCalls: "required"}, {maximumSources: 5},
    {maximumSourceBytes: 8 * 1024 * 1024}, {maximumTotalBytes: 32 * 1024 * 1024}, {maximumChunks: 1001},
    {reviewRequired: false}, {explicitSaveRequired: false}, {immutableVersion: true}, {outputFormat: "jsonl"},
    {maximumRowsPerSource: 1000}, {effect: "saved-system-write"}]) {
    const tampered = {...value, preview: {...built.preview, steps: [{...built.preview.steps[0], ...changed}]}};
    assert.equal(readDesktopPlanApprovalView(tampered, selection, capabilities), undefined);
    assert.equal(readManagedBrowserPlanApprovalValue(request, tampered, capabilities), undefined);
  }
  for (const field of ["maximumSources", "maximumSourceBytes", "maximumTotalBytes", "maximumChunks", "modelCalls",
    "reviewRequired", "explicitSaveRequired"]) {
    const step: Record<string, unknown> = {...built.preview.steps[0]}; delete step[field];
    assert.equal(readDesktopPlanApprovalView({...value, preview: {...built.preview, steps: [step]}}, selection, capabilities), undefined);
  }
});

test("Context receipts identify an accepted task without claiming a saved result or exposing private fields", () => {
  const exact = {hostIncarnationId: host, workspaceId: input.workspaceId, fingerprint: "b".repeat(64), approvalRevision: 2, step: 1};
  const value = {kind: "started", operation: wire.operation, reference: {workspaceId: input.workspaceId, taskId: randomUUID()},
    fingerprint: exact.fingerprint, approvalRevision: 2, step: 1, expiresAt: Date.now() + 60000};
  for (const kind of ["started", "replayed"]) {
    const result = {ok: true, value: {...value, kind}};
    assert.deepEqual(readHeadlessPlanStepResult(result, exact, capabilities), result);
  }
  assert.equal(readHeadlessPlanStepResult({ok: true, value}, exact).ok, false);
  for (const changed of [{...value, kind: "committed"}, {...value, reference: {...value.reference, path: "private"}},
    {...value, reference: {...value.reference, workspaceId: "foreign"}}, {...value, reference: {...value.reference, taskId: "unknown"}},
    {...value, reference: {...value.reference, artifactId: "not-saved"}}])
    assert.equal(readHeadlessPlanStepResult({ok: true, value: changed}, exact, capabilities).ok, false);
});

test("Context pack proposals cannot smuggle model/runtime choices, raw sources, guessed task IDs or publication", () => {
  for (const changed of [
    {...input, idempotencyKey: "not-an-owned-key"}, {...input, taskId: host}, {...input, runtime: {install: true}},
    {...input, output: {repository: "private/test"}}, {...input, instructions: "Execute a command"},
    {...input, sources: [{...input.sources[0], path: "private/source.csv"}]},
    {...input, sources: [{...input.sources[0], content: "raw source"}]},
    {...input, settings: {...input.settings, modelId: "supplier/model"}},
    {...input, settings: {...input.settings, method: "local-model"}},
    {...input, settings: {...input.settings, maximumChunks: 1001}},
    {...input, settings: {...input.settings, kind: "rag-database", device: "auto"}},
  ]) assert.equal(readHeadlessContextPackPlanRequest({...wire, input: changed}, host).ok, false);
  let getters = 0; const accessor = {...input};
  Object.defineProperty(accessor, "settings", {enumerable: true, get() {getters++; return input.settings;}});
  assert.equal(readHeadlessContextPackPlanRequest({...wire, input: accessor}, host).ok, false); assert.equal(getters, 0);
});

const ragSettings = {kind: "rag-database", chunkCharacters: 500, overlapCharacters: 50, maximumChunks: 100, textFields: ["text"],
  modelRecordId: "model.synthetic", modelUpdatedAt: "2026-11-18T00:00:00.000Z", batchSize: 4, device: "cpu",
  sourceChecks: {preset: "recommended", allowedLanguages: ["en"], requireLicenseMetadata: false,
    requireConsentMetadata: false, includeSourceAttribution: true}};
const ragWire = {version, operation: "context.generate-rag", input: {...input, settings: ragSettings}};
const ragProposal = {...proposal, steps: [{operation: ragWire.operation, ...fields, settings: ragSettings}]};
const ragCapabilities = {...capabilities, allowContextRagGeneration: true};

test("RAG generation has separate opt-in authority and a v7 local-embedding preview", () => {
  const decoded = readHeadlessContextGenerationPlanRequest(ragWire, host); assert.ok(decoded.ok);
  assert.deepEqual(decoded.request, ragWire);
  assert.notEqual(decoded.request.input.settings, ragSettings);
  assert.equal(readHeadlessContextPackPlanRequest(ragWire, host).ok, false);
  assert.equal(readHeadlessContextGenerationPlanRequest({...ragWire, input}, host).ok, false);
  assert.equal(readHeadlessContextGenerationPlanRequest({...wire, input: ragWire.input}, host).ok, false);
  assert.equal(parseHeadlessBuildPlanProposal(ragProposal, host, capabilities).ok, false);
  const built = parseHeadlessBuildPlanProposal(ragProposal, host, {...ragCapabilities, allowContextPackGeneration: false});
  assert.ok(built.ok); assert.equal(built.preview.version, "aisb-build-plan-preview-v7");
  assert.equal(built.preview.steps[0].effect, "generate-rag-database");
  assert.equal(built.preview.steps[0].externalProviderCalls, 0);
  assert.equal("modelCalls" in built.preview.steps[0] && built.preview.steps[0].modelCalls, "required");
  const pack = parseHeadlessBuildPlanProposal(proposal, host, ragCapabilities); assert.ok(pack.ok);
  assert.equal(pack.preview.version, "aisb-build-plan-preview-v6");
  for (const patch of [{localModelReference: "private/model"}, {modelId: "supplier/model"}, {modelUpdatedAt: "bad"},
    {device: "auto"}, {batchSize: 33}, {trustRemoteCode: true}, {sourceChecks: {...ragSettings.sourceChecks, prompt: "execute"}}])
    assert.equal(readHeadlessContextGenerationPlanRequest({...ragWire, input: {...ragWire.input, settings: {...ragSettings, ...patch}}}, host).ok, false);
});

test("both approval channels bind RAG permissions and reject hidden or altered limits", () => {
  const built = parseHeadlessBuildPlanProposal(ragProposal, host, ragCapabilities); assert.ok(built.ok);
  const selection = {workspaceId: input.workspaceId, fingerprint: "c".repeat(64), registeredClientId: randomUUID()};
  const value = {selection, viewId: randomUUID(), preview: built.preview, state: {fingerprint: selection.fingerprint,
    revision: 1, stepCount: 1, approvedSteps: 0, expiresAt: Date.now() + 60000, status: "pending"}};
  const request = {operation: "open" as const, selection, document: {hostIncarnationId: host,
    workspaceId: input.workspaceId, windowId: randomUUID(), uiIncarnationId: randomUUID()}};
  assert.deepEqual(readDesktopPlanApprovalView(value, selection, ragCapabilities), value);
  assert.deepEqual(readManagedBrowserPlanApprovalValue(request, value, ragCapabilities), value);
  assert.equal(readDesktopPlanApprovalView(value, selection, capabilities), undefined);
  assert.equal(readManagedBrowserPlanApprovalValue(request, value, capabilities), undefined);
  for (const patch of [{modelCalls: 0}, {externalProviderCalls: "required"}, {maximumSources: 5}, {maximumTotalBytes: 32 * 1024 * 1024},
    {maximumChunks: 1001}, {reviewRequired: false}, {explicitSaveRequired: false}, {effect: "generate-context-pack"},
    {maximumRowsPerSource: 1000}]) {
    const changed = {...value, preview: {...built.preview, steps: [{...built.preview.steps[0], ...patch}]}};
    assert.equal(readDesktopPlanApprovalView(changed, selection, ragCapabilities), undefined);
    assert.equal(readManagedBrowserPlanApprovalValue(request, changed, ragCapabilities), undefined);
  }
});

test("RAG receipts expose only accepted task identity under their own capability", () => {
  const exact = {hostIncarnationId: host, workspaceId: input.workspaceId, fingerprint: "d".repeat(64), approvalRevision: 2, step: 1};
  const value = {kind: "started", operation: ragWire.operation, reference: {workspaceId: input.workspaceId, taskId: randomUUID()},
    fingerprint: exact.fingerprint, approvalRevision: 2, step: 1, expiresAt: Date.now() + 60000};
  assert.deepEqual(readHeadlessPlanStepResult({ok: true, value}, exact, ragCapabilities), {ok: true, value});
  assert.equal(readHeadlessPlanStepResult({ok: true, value}, exact, capabilities).ok, false);
  for (const patch of [{kind: "committed"}, {reference: {...value.reference, path: "private/model"}},
    {reference: {...value.reference, workspaceId: "foreign"}}, {reference: {...value.reference, artifactId: "not-saved"}}])
    assert.equal(readHeadlessPlanStepResult({ok: true, value: {...value, ...patch}}, exact, ragCapabilities).ok, false);
});
