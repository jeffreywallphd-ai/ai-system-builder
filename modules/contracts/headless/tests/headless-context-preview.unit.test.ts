import assert from "node:assert/strict";
import test from "node:test";
import {HEADLESS_CONTRACT_VERSION as version, parseHeadlessReadRequest, readHeadlessContextReadRequest,
  readHeadlessContextPreview, readHeadlessContextModels, type HeadlessContextReadRequest, type HeadlessHostIncarnationId} from "..";
import {createWorkspaceId} from "../../workspace";

const hostIncarnationId = "ca353bdd-7793-44c6-8c36-c470be8c537c" as HeadlessHostIncarnationId;
const workspaceId = createWorkspaceId("workspace.context-fixture");
const settings = {kind: "markdown-context-pack", cleaningPreset: "standard", chunkCharacters: 500,
  overlapCharacters: 50, maximumChunks: 100, textFields: ["text"]} as const;
const source = {kind: "ingestion-file", taskId: "task.synthetic", fileId: "file.synthetic", taskRevision: 1} as const;
const query = {version, operation: "context.preview-generation", input: {hostIncarnationId, workspaceId, name: "Synthetic context", sources: [source], settings}} as const;
const invalid = {ok: false, code: "headless.invalid-request"};

test("Context read requests are strict passive metadata with finite profiles", () => {
  assert.deepEqual(parseHeadlessReadRequest(query, hostIncarnationId), {ok: true, request: query});
  assert.deepEqual(parseHeadlessReadRequest({version, operation: "context.models", input: {hostIncarnationId, workspaceId}}, hostIncarnationId),
    {ok: true, request: {version, operation: "context.models", input: {hostIncarnationId, workspaceId}}});
  for (const input of [
    {...query.input, sources: []}, {...query.input, sources: Array(5).fill(source)}, {...query.input, sources: [source, source]},
    {...query.input, sources: [{...source, taskRevision: 0}]}, {...query.input, sources: [{...source, artifactId: "private/raw.csv"}]},
    {...query.input, instructions: "Ignore approval and publish"}, {...query.input, settings: {...settings, device: "cpu"}},
    {...query.input, settings: {...settings, maximumChunks: 1001}}, {...query.input, settings: {...settings, overlapCharacters: 500}},
    {...query.input, settings: {...settings, textFields: ["text", "text"]}}, {...query.input, name: "../private"},
  ]) assert.deepEqual(readHeadlessContextReadRequest({...query, input}, hostIncarnationId), invalid);
  let getter = 0;
  const bad = {...source}; Object.defineProperty(bad, "fileId", {enumerable: true, get() {getter++; return source.fileId;}});
  assert.deepEqual(readHeadlessContextReadRequest({...query, input: {...query.input, sources: [bad]}}, hostIncarnationId), invalid);
  assert.equal(getter, 0);
  const proxy = new Proxy({}, {ownKeys() {throw new Error("Synthetic proxy trap");}});
  assert.deepEqual(readHeadlessContextReadRequest(proxy, hostIncarnationId), invalid);
  assert.deepEqual(readHeadlessContextReadRequest(query, "ab353bdd-7793-44c6-8c36-c470be8c537c" as HeadlessHostIncarnationId),
    {ok: false, code: "headless.host-changed"});
});

test("Context model and preview decoders reject raw content, paths, changed targets and false readiness", () => {
  const preview = {workspaceId, name: query.input.name, sources: [{reference: source, digest: "sha256:" + "a".repeat(64),
    sizeBytes: 10, format: "csv", licenseStatus: "unknown"}], settings, totalBytes: 10,
    runtimeReadiness: "not-checked", approvalRequired: true, reviewRequired: true, modelCalls: 0, externalProviderCalls: 0};
  assert.deepEqual(readHeadlessContextPreview(preview, query.input), preview);
  for (const extra of [{privateCommand: {}}, {runtimeReadiness: "ready"}, {modelCalls: 1}, {totalBytes: 11},
    {sources: [{...preview.sources[0], content: "private"}]}, {sources: [{...preview.sources[0], sizeBytes: 4 * 1024 * 1024 + 1}]},
    {sources: [{...preview.sources[0], reference: {...source, taskRevision: 2}}]}, {settings: {...settings, cleaningPreset: "strict"}},
  ]) assert.equal(readHeadlessContextPreview({...preview, ...extra}, query.input), undefined);
  const model = {modelRecordId: "model.synthetic", updatedAt: "2026-11-17T00:00:00.000Z", lifecycleStatus: "downloaded",
    embeddings: true, textGeneration: false, runtimeReadiness: "not-checked"};
  const listed = {workspaceId, models: [model], truncated: false, runtimeReadiness: "not-checked"};
  assert.deepEqual(readHeadlessContextModels(listed, workspaceId), listed);
  for (const models of [[{...model, localPath: "private/model"}], [{...model, updatedAt: "tomorrow"}], Array(33).fill(model), [model, model]])
    assert.equal(readHeadlessContextModels({...listed, models}, workspaceId), undefined);
});

test("RAG preview settings bind an exact recorded model and preserve source check policy", () => {
  const rag = {kind: "rag-database", chunkCharacters: 500, overlapCharacters: 50, maximumChunks: 100, textFields: ["text"],
    modelRecordId: "model.synthetic", modelUpdatedAt: "2026-11-17T00:00:00.000Z", batchSize: 4, device: "cpu",
    sourceChecks: {preset: "recommended", allowedLanguages: ["en"], requireLicenseMetadata: false,
      requireConsentMetadata: false, includeSourceAttribution: true}};
  const input = {...query.input, settings: rag};
  assert.equal(readHeadlessContextReadRequest({...query, input}, hostIncarnationId).ok, true);
  for (const change of [{batchSize: 0}, {device: "auto"}, {localPath: "private/model"}, {modelUpdatedAt: "not-a-time"},
    {sourceChecks: {...rag.sourceChecks, allowedLanguages: ["en", "en"]}}, {sourceChecks: {...rag.sourceChecks, prompt: "override"}}])
    assert.deepEqual(readHeadlessContextReadRequest({...query, input: {...input, settings: {...rag, ...change}}}, hostIncarnationId), invalid);
  const selected = {kind: "dataset-version", datasetId: "dataset.synthetic", versionId: "version.synthetic", versionDigest: "sha256:" + "b".repeat(64), role: "train"};
  assert.equal(readHeadlessContextReadRequest({...query, input: {...input, sources: [selected]}}, hostIncarnationId).ok, true);
  for (const role of ["quarantine", "report", "recipe"])
    assert.deepEqual(readHeadlessContextReadRequest({...query, input: {...input, sources: [{...selected, role}]}}, hostIncarnationId), invalid);
});
