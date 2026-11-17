import assert from "node:assert/strict";
import test from "node:test";
import {HEADLESS_CONTRACT_VERSION, type HeadlessHostIncarnationId} from "../headless-protocol";
import {readHeadlessLocalDatasetPlanRequest} from "../headless-dataset-plan";
import {parseHeadlessBuildPlanProposal} from "../headless-system-management";
import {readHeadlessPlanStepResult} from "../headless-plan-step-wire";

const host = "39d742a5-c4a4-4aaf-9d11-a611ad9ab130" as HeadlessHostIncarnationId;
const workspaceId = "workspace.synthetic" as import("../../workspace").WorkspaceId;
const input = {hostIncarnationId: host, workspaceId, idempotencyKey: "da914265-c9bb-4cc0-8ccb-35e4a0ad283d",
  sources: [{taskId: "source.task", fileId: "source.file", taskRevision: 4}],
  recipe: {kind: "provided-instruction-rows-v1", inputColumn: "question", outputColumn: "answer"},
  split: {trainRatio: 0.8, validationRatio: 0.1, testRatio: 0.1, seed: 42}, qualityPreset: "recommended"};
const wire = {version: HEADLESS_CONTRACT_VERSION, operation: "data.prepare-local-dataset", input};
const {hostIncarnationId: _host, workspaceId: _workspace, ...fields} = input;
const proposal = {hostIncarnationId: host, workspaceId, steps: [{operation: wire.operation, ...fields}]};
const capabilities = {allowLocalFileSave: true, allowProviderFileSave: true, allowLocalDatasetPreparation: true};

test("a concrete dataset plan is detached, opt-in and precise about processing limits", () => {
  const decoded = readHeadlessLocalDatasetPlanRequest(wire, host);
  assert.deepEqual(decoded, {ok: true, request: wire});
  assert.ok(decoded.ok); assert.notEqual(decoded.request.input.sources, input.sources);
  assert.equal(parseHeadlessBuildPlanProposal(proposal, host).ok, false);
  const parsed = parseHeadlessBuildPlanProposal(proposal, host, capabilities);
  assert.ok(parsed.ok); assert.equal(parsed.preview.version, "aisb-build-plan-preview-v4");
  assert.deepEqual(parsed.preview.steps[0], {operation: wire.operation, input: fields, effect: "prepare-local-dataset",
    externalProviderCalls: 0, modelCalls: 0, maximumSourceBytes: 4 * 1024 * 1024, maximumTotalBytes: 16 * 1024 * 1024,
    maximumRowsPerSource: 1000, outputFormat: "jsonl", reviewRequired: true});
});

test("dataset planning cannot add runtime IDs, model calls, source paths or guessed future source revisions", () => {
  for (const invalid of [{...input, taskId: host}, {...input, runtime: {}}, {...input, output: {repository: "synthetic"}},
    {...input, sources: [{...input.sources[0], path: "private"}]}, {...input, qualityPreset: "disabled"}])
    assert.equal(readHeadlessLocalDatasetPlanRequest({...wire, input: invalid}, host).ok, false);
  const save = {operation: "data.save-local-source", idempotencyKey: "3d4fed5c-825d-4c8b-aafb-6f1a3814b695",
    taskId: "source.task", fileId: "source.file", taskRevision: 1};
  for (const steps of [[save, ...proposal.steps], [...proposal.steps, save]])
    assert.equal(parseHeadlessBuildPlanProposal({...proposal, steps}, host, capabilities).ok, false);
});

test("a dataset start receipt names an accepted task and cannot pretend a dataset is finished or leak private fields", () => {
  const target = {hostIncarnationId: host, workspaceId, fingerprint: "a".repeat(64), approvalRevision: 2, step: 1};
  const response = {ok: true, value: {kind: "started", operation: wire.operation, fingerprint: target.fingerprint,
    approvalRevision: 2, step: 1, expiresAt: 2_000_000_000_000, reference: {workspaceId, taskId: host}}};
  assert.deepEqual(readHeadlessPlanStepResult(response, target, capabilities), response);
  assert.equal(readHeadlessPlanStepResult(response, target).ok, false);
  for (const value of [{...response.value, kind: "committed"},
    {...response.value, reference: {...response.value.reference, datasetId: "not-saved"}},
    {...response.value, reference: {...response.value.reference, path: "private"}},
    {...response.value, reference: {...response.value.reference, workspaceId: "foreign"}}])
    assert.equal(readHeadlessPlanStepResult({ok: true, value}, target, capabilities).ok, false);
});
