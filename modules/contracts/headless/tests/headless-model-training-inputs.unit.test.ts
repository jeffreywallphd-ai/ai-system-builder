import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {createWorkspaceId} from "../../workspace";
import {normalizeDatasetId, normalizeDatasetVersionId} from "../../dataset";
import {HEADLESS_CONTRACT_VERSION as version, isHeadlessHostIncarnationId} from "../headless-protocol";
import {parseHeadlessReadRequest} from "../headless-read-request";
import {readHeadlessModelTrainingInputsRequest, readHeadlessModelTrainingInputsValue, readHeadlessModelTrainingInputsResult} from "../headless-model-training-inputs";

function fixture() {
  const host = randomUUID(); assert.ok(isHeadlessHostIncarnationId(host));
  const workspaceId = createWorkspaceId("workspace.training-inputs"), at = "2026-11-21T00:00:00.000Z";
  const input = {hostIncarnationId: host, workspaceId, model: {modelRecordId: "model.synthetic", updatedAt: at},
    dataset: {datasetId: normalizeDatasetId("dataset.synthetic"), versionId: normalizeDatasetVersionId("version.synthetic"), versionDigest: "sha256:" + "a".repeat(64)}};
  const request = {version, operation: "models.preview-training-inputs", input};
  const decoded = readHeadlessModelTrainingInputsRequest(request, host); assert.ok(decoded.ok);
  const value = {workspaceId, model: {modelRecordId: input.model.modelRecordId, updatedAt: at, source: "local", lifecycleStatus: "downloaded",
    artifactForm: "full-model", provider: "huggingface", modelId: "fixture/model", taskTags: ["chat"], serializationFormat: "safetensors"},
    dataset: {datasetId: input.dataset.datasetId, version: {versionId: input.dataset.versionId, versionDigest: input.dataset.versionDigest, createdAt: at,
      totalRows: 10, sourceCount: 1, artifactCount: 4, parentVersionId: null, splitSeed: 42, recipeDigest: "sha256:" + "b".repeat(64),
      quality: {policyFingerprint: "sha256:" + "c".repeat(64), reportFingerprint: "sha256:" + "d".repeat(64)},
      splits: [{role: "train", rowCount: 6}, {role: "validation", rowCount: 2}, {role: "test", rowCount: 2}]}},
    verification: {inputBytes: "not-checked", runtimeReadiness: "not-checked", trainingCompatibility: "not-checked", resourceAdmission: "not-checked",
      licenseRights: "not-checked", qualityReport: "recorded-not-rechecked"}, trainingApproval: "required"};
  return {host, request, input: decoded.request.input, value};
}

test("training input selection is a detached exact model revision and immutable dataset reference", () => {
  const f = fixture(), parsed = readHeadlessModelTrainingInputsRequest(f.request, f.host); assert.ok(parsed.ok);
  assert.deepEqual(parsed.request, f.request); assert.notEqual(parsed.request.input.model, f.request.input.model);
  f.request.input.dataset.versionId = normalizeDatasetVersionId("version.changed");
  assert.equal(parsed.request.input.dataset.versionId, "version.synthetic");
  assert.equal(parseHeadlessReadRequest({...f.request, input: f.input}, f.host).ok, false, "The standalone private codec does not activate public read support.");
});

test("training input requests reject hidden paths/powers, malformed versions and active values without invoking getters", () => {
  const f = fixture(); let hooks = 0; const active = {...f.request.input};
  Object.defineProperty(active, "model", {enumerable: true, get() {hooks++; return f.request.input.model;}});
  assert.equal(readHeadlessModelTrainingInputsRequest({...f.request, input: active}, f.host).ok, false); assert.equal(hooks, 0);
  for (const patch of [{localPath: "private/model"}, {modelWrite: true}, {approved: true}, {trainingTask: "arbitrary"},
    {model: {...f.request.input.model, updatedAt: "2026-02-30T00:00:00.000Z"}}, {model: {...f.request.input.model, modelRecordId: "../model"}},
    {dataset: {...f.request.input.dataset, versionDigest: "sha256:invalid"}}, {dataset: {...f.request.input.dataset, artifactKey: "private/data"}}])
    assert.equal(readHeadlessModelTrainingInputsRequest({...f.request, input: {...f.request.input, ...patch}}, f.host).ok, false);
  const other = randomUUID(); assert.ok(isHeadlessHostIncarnationId(other));
  assert.deepEqual(readHeadlessModelTrainingInputsRequest(f.request, other), {ok: false, code: "headless.host-changed"});
});

test("preview replies preserve metadata-only status and cannot become model/file/license/quality/training authority", () => {
  const f = fixture(), value = readHeadlessModelTrainingInputsValue(f.value, f.input); assert.ok(value);
  assert.deepEqual(value, f.value); assert.notEqual(value.model.taskTags, f.value.model.taskTags);
  for (const key of Object.keys(f.value.verification)) {
    assert.equal(readHeadlessModelTrainingInputsValue({...f.value, verification: {...f.value.verification, [key]: "passed"}}, f.input), undefined);
  }
  for (const patch of [{localPath: "private"}, {trainingApproval: "granted"}, {model: {...f.value.model, localPath: "private"}},
    {model: {...f.value.model, updatedAt: "2026-11-22T00:00:00.000Z"}}, {dataset: {...f.value.dataset, version: {...f.value.dataset.version, versionDigest: "sha256:" + "e".repeat(64)}}},
    {workspaceId: createWorkspaceId("foreign.workspace")}, {verification: {...f.value.verification, approvalGranted: true}}])
    assert.equal(readHeadlessModelTrainingInputsValue({...f.value, ...patch}, f.input), undefined);
});

test("result envelope is finite, correlated and refuses private error or reply fields", () => {
  const f = fixture(), result = {ok: true, operation: "models.preview-training-inputs", value: f.value};
  assert.deepEqual(readHeadlessModelTrainingInputsResult(result, f.input), result);
  assert.deepEqual(readHeadlessModelTrainingInputsResult({ok: false, code: "headless.stale"}, f.input), {ok: false, code: "headless.stale"});
  for (const value of [{...result, error: "private"}, {ok: false, code: "headless.stale", privateDetails: "private"},
    {ok: false, code: "private-error"}, {...result, operation: "models.train"}])
    assert.deepEqual(readHeadlessModelTrainingInputsResult(value, f.input), {ok: false, code: "headless.unavailable"});
});
