import assert from "node:assert/strict";
import test from "node:test";
import {HEADLESS_CONTRACT_VERSION, parseHeadlessReadRequest, type HeadlessHostIncarnationId} from "../headless-read-request";
import {readHeadlessDatasetPreparationRequest, readHeadlessDatasetPreparationPreview} from "../headless-dataset-preparation";

const host = "ca353bdd-7793-44c6-8c36-c470be8c537c" as HeadlessHostIncarnationId;
const request = {version: HEADLESS_CONTRACT_VERSION, operation: "data.preview-dataset-preparation", input: {
  hostIncarnationId: host, workspaceId: "workspace.synthetic", sources: [{taskId: "task.synthetic", fileId: "file.synthetic", taskRevision: 3}],
  recipe: {kind: "provided-instruction-rows-v1", inputColumn: "question", outputColumn: "answer"},
  split: {trainRatio: 0.8, validationRatio: 0.1, testRatio: 0.1, seed: 42}, qualityPreset: "recommended",
}};

test("the provided-row request is a detached exact source, mapping, split and quality selection", () => {
  const result = readHeadlessDatasetPreparationRequest(request, host);
  assert.deepEqual(result, {ok: true, request});
  assert.ok(result.ok);
  assert.notEqual(result.request.input, request.input);
  assert.notEqual(result.request.input.sources, request.input.sources);
  assert.deepEqual(parseHeadlessReadRequest(request, host), {ok: true, request});
  assert.deepEqual(readHeadlessDatasetPreparationRequest(request, "07cbb8d5-5a1b-4e8d-ae4a-75b9a26e6995" as HeadlessHostIncarnationId),
    {ok: false, code: "headless.host-changed"});
});

test("the public preview reconstructs exact requested metadata and excludes private commands or changed permissions", () => {
  const parsed = readHeadlessDatasetPreparationRequest(request, host);
  assert.ok(parsed.ok);
  const target = parsed.request.input;
  const preview = {workspaceId: target.workspaceId, sources: target.sources.map(source => ({...source,
    sourceSnapshotId: "snapshot.synthetic", format: "csv", sizeBytes: 32, digest: "sha256:" + "a".repeat(64), licenseStatus: "unknown"})),
    recipe: target.recipe, split: target.split, qualityPreset: target.qualityPreset, totalBytes: 32,
    maximumRowsPerSource: 1000, outputFormat: "jsonl", reviewRequired: true, externalProviderCalls: 0, modelCalls: 0};
  assert.deepEqual(readHeadlessDatasetPreparationPreview(preview, target), preview);
  for (const invalid of [
    {...preview, command: {sourceArtifactIds: ["private-source"]}}, {...preview, workspaceId: "foreign"},
    {...preview, recipe: {...preview.recipe, outputColumn: "changed"}}, {...preview, split: {...preview.split, seed: 43}},
    {...preview, qualityPreset: "strict"}, {...preview, totalBytes: 31}, {...preview, maximumRowsPerSource: 1001},
    {...preview, outputFormat: "parquet"}, {...preview, reviewRequired: false}, {...preview, externalProviderCalls: 1},
    {...preview, modelCalls: 1}, {...preview, sources: [{...preview.sources[0], fileId: "foreign"}]},
    {...preview, sources: [{...preview.sources[0], sourceSnapshotId: "../private"}]},
    {...preview, sources: [{...preview.sources[0], sizeBytes: 4 * 1024 * 1024 + 1}]},
    {...preview, sources: [{...preview.sources[0], licenseStatus: "open"}]},
    {...preview, sources: [{...preview.sources[0], format: "pdf"}]},
    {...preview, sources: [{...preview.sources[0], localPath: "private-source"}]},
  ]) assert.equal(readHeadlessDatasetPreparationPreview(invalid, target), undefined);
});

test("source and recipe inputs cannot add paths, runtime controls, provider authority or model generation", () => {
  const input = request.input;
  const invalid = [
    {...input, sources: []}, {...input, sources: Array.from({length: 5}, () => input.sources[0])},
    {...input, sources: [input.sources[0], input.sources[0]]},
    {...input, sources: [{...input.sources[0], path: "private"}]},
    {...input, sources: [{...input.sources[0], taskId: "task.synthetic "}]},
    {...input, sources: [{...input.sources[0], taskRevision: 0}]},
    {...input, runtime: {command: "synthetic"}}, {...input, output: {repository: "private"}},
    {...input, recipe: {...input.recipe, generation: {model: "synthetic"}}},
    {...input, recipe: {...input.recipe, inputColumn: "$(synthetic)"}},
    {...input, recipe: {...input.recipe, inputColumn: "../private"}},
    {...input, recipe: {...input.recipe, inputColumn: "answer"}},
    {...input, split: {...input.split, seed: -1}}, {...input, split: {...input.split, trainRatio: 0.5}},
    {...input, split: {...input.split, trainRatio: 1, validationRatio: 0, testRatio: 0}},
    {...input, split: {...input.split, testRatio: Number.NaN}},
    {...input, split: {...input.split, shuffle: false}}, {...input, qualityPreset: "disabled"},
    {...input, organizationId: "foreign"},
  ];
  for (const value of invalid) assert.deepEqual(readHeadlessDatasetPreparationRequest({...request, input: value}, host),
    {ok: false, code: "headless.invalid-request"});
  let calls = 0;
  const getter = {...request};
  Object.defineProperty(getter, "input", {enumerable: true, get() {calls++; return input;}});
  assert.equal(readHeadlessDatasetPreparationRequest(getter, host).ok, false);
  assert.equal(calls, 0);
});

test("a preview cannot run accessor code or inherit a source array from its prototype", () => {
  const parsed = readHeadlessDatasetPreparationRequest(request, host);
  assert.ok(parsed.ok);
  let calls = 0;
  const getter = Object.defineProperty({}, "sources", {enumerable: true, get() {calls++; throw new Error("Unexpected source access.");}});
  assert.equal(readHeadlessDatasetPreparationPreview(getter, parsed.request.input), undefined);
  assert.equal(readHeadlessDatasetPreparationPreview(Object.create({sources: []}), parsed.request.input), undefined);
  assert.equal(calls, 0);
});
