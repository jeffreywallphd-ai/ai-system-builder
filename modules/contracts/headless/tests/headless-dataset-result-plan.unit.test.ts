import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import test from "node:test";
import {HEADLESS_CONTRACT_VERSION, parseHeadlessBuildPlanProposal, readHeadlessDatasetResultSavePlanRequest,
  readDesktopPlanApprovalView, readHeadlessPlanStepResult} from "../index";

const host = randomUUID(), taskId = randomUUID(), workspaceId = "workspace.synthetic";
const input = {hostIncarnationId: host, workspaceId, idempotencyKey: randomUUID(), taskId,
  reportFingerprint: "a".repeat(64), outputBaseName: "Reviewed support answers"};
const wire = {version: HEADLESS_CONTRACT_VERSION, operation: "data.save-prepared-dataset", input};
const {hostIncarnationId: _host, workspaceId: _workspace, ...fields} = input;
const proposal = {hostIncarnationId: host, workspaceId, steps: [{operation: wire.operation, ...fields}]};
const capabilities = {allowLocalFileSave: true, allowProviderFileSave: true, allowLocalDatasetPreparation: true, allowDatasetResultSave: true};

test("saving a prepared result is an explicit opt-in v5 plan and cannot approve processing or external publication", () => {
  assert.deepEqual(readHeadlessDatasetResultSavePlanRequest(wire, host), {ok: true, request: wire});
  assert.equal(parseHeadlessBuildPlanProposal(proposal, host).ok, false);
  assert.equal(parseHeadlessBuildPlanProposal(proposal, host, {...capabilities, allowDatasetResultSave: false}).ok, false);
  const decoded = parseHeadlessBuildPlanProposal(proposal, host, capabilities);
  assert.ok(decoded.ok); assert.equal(decoded.preview.version, "aisb-build-plan-preview-v5");
  assert.deepEqual(decoded.preview.steps[0], {operation: wire.operation, input: fields, effect: "save-prepared-dataset",
    externalProviderCalls: 0, modelCalls: 0, outputFormat: "jsonl", immutableVersion: true});
  assert.equal(parseHeadlessBuildPlanProposal({...proposal, steps: [...proposal.steps, {...proposal.steps[0], idempotencyKey: randomUUID()}]}, host, capabilities).ok, false);
});

test("result saving rejects unchecked task/report/name extensions and stale hosts", () => {
  for (const bad of [{...input, taskId: "unknown"}, {...input, reportFingerprint: "changed"},
    {...input, outputBaseName: "../private"}, {...input, outputBaseName: " padded "}, {...input, outputBaseName: ""},
    {...input, outputBaseName: "x".repeat(161)}, {...input, runtime: {}}, {...input, repository: "unapproved"},
    {...input, report: {rows: ["private"]}}])
    assert.equal(readHeadlessDatasetResultSavePlanRequest({...wire, input: bad}, host).ok, false);
  assert.deepEqual(readHeadlessDatasetResultSavePlanRequest(wire, randomUUID()), {ok: false, code: "headless.host-changed"});
});

test("the approval view reconstructs exact v5 permissions and refuses changed effects or disabled saving", () => {
  const built = parseHeadlessBuildPlanProposal(proposal, host, capabilities); assert.ok(built.ok);
  const fingerprint = createHash("sha256").update(JSON.stringify(built.preview)).digest("hex");
  const selection = {workspaceId, fingerprint, registeredClientId: randomUUID()};
  const value = {selection, viewId: randomUUID(), preview: built.preview,
    state: {fingerprint, revision: 1, stepCount: 1, approvedSteps: 0, expiresAt: Date.now() + 60000, status: "pending"}};
  assert.deepEqual(readDesktopPlanApprovalView(value, selection, capabilities), value);
  assert.equal(readDesktopPlanApprovalView(value, selection, {...capabilities, allowDatasetResultSave: false}), undefined);
  for (const change of [{immutableVersion: false}, {modelCalls: 1}, {externalProviderCalls: "required"}, {maximumRowsPerSource: 1000}])
    assert.equal(readDesktopPlanApprovalView({...value, preview: {...built.preview,
      steps: [{...built.preview.steps[0], ...change}]}}, selection, capabilities), undefined);
});

test("a saved result receipt contains only an exact immutable version reference and cannot pretend it merely started", () => {
  const target = {hostIncarnationId: host, workspaceId, fingerprint: "b".repeat(64), approvalRevision: 2, step: 1};
  const reference = {workspaceId, taskId, datasetId: "support-answers", versionId: "support-answers:1234", versionDigest: "sha256:" + "c".repeat(64)};
  const response = {ok: true, value: {kind: "committed", operation: wire.operation, reference,
    fingerprint: target.fingerprint, approvalRevision: 2, step: 1, expiresAt: Date.now() + 60000}};
  assert.deepEqual(readHeadlessPlanStepResult(response, target, capabilities), response);
  assert.equal(readHeadlessPlanStepResult(response, target).ok, false);
  for (const changed of [{...response.value, kind: "started"},
    {...response.value, reference: {...reference, path: "private"}}, {...response.value, reference: {...reference, workspaceId: "foreign"}},
    {...response.value, reference: {...reference, versionDigest: "invalid"}}])
    assert.equal(readHeadlessPlanStepResult({ok: true, value: changed}, target, capabilities).ok, false);
});
