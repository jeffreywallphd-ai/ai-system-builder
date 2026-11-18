import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {readHeadlessContextPackPlanRequest} from "../headless-context-plan";
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
