import assert from "node:assert/strict";
import test from "node:test";
import {HEADLESS_CONTRACT_VERSION as protocol, type HeadlessDatasetVersionsRequest,
  type HeadlessDatasetComparisonRequest, type HeadlessHostIncarnationId} from "../../../../contracts/headless";
import {normalizeDatasetVersionId, normalizeDatasetId} from "../../../../contracts/dataset";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {ReadHeadlessDatasetMetadataUseCase} from "../headless-dataset-metadata.use-case";
import {fixture, version, workspaceId, organizationId, principalId} from "./headless-dataset-metadata.fixture";

const target = {hostIncarnationId: "e14c2b3d-249f-47d9-b742-838044a95182" as HeadlessHostIncarnationId, workspaceId};
const selected: HeadlessDatasetVersionsRequest = {version: protocol, operation: "data.dataset-versions",
  input: {...target, datasetId: normalizeDatasetId("dataset.synthetic"), versionIds: [normalizeDatasetVersionId("version.001")]}};
const compare: HeadlessDatasetComparisonRequest = {version: protocol, operation: "data.compare-dataset-versions",
  input: {...target, fromVersionId: normalizeDatasetVersionId("version.001"), toVersionId: normalizeDatasetVersionId("version.002")}};
const context = {organizationId, principalId, workspaceId};
const denied = {ok: false, code: "headless.forbidden"};

test("actual immutable version inspection uses at most sixteen point reads and never scans unrelated history", async () => {
  const {queries, repository, readCount} = await fixture(20);
  const authority = {context, stillAllowed: async () => true};
  const versionIds = Array.from({length: 16}, (_, index) => version(16 - index).versionId);
  const result = await queries.execute({...selected, input: {...selected.input, versionIds}}, authority);
  assert.ok(result.ok && result.operation === "data.dataset-versions");
  assert.equal(readCount(), 16);
  assert.deepEqual(result.value.versions.map(item => item.versionId), versionIds);
  assert.deepEqual(result.value.versions[0].splits, [{role: "train", rowCount: 6}, {role: "validation", rowCount: 2}, {role: "test", rowCount: 2}]);
  assert.equal(result.value.versions[0].splitSeed, 42);
  assert.equal(result.value.versions[0].sourceCount, 1);
  assert.equal(result.value.versions[0].artifactCount, 4);
  assert.ok(!/private|artifactKey|groupField|summary|createdBy/.test(JSON.stringify(result)));
  assert.equal((await repository.listVersions(workspaceId)).length, 20);
  const before = readCount();
  assert.deepEqual(await queries.execute({...selected, input: {...selected.input, versionIds: []}}, authority), {ok: false, code: "headless.result-too-large"});
  assert.deepEqual(await queries.execute({...selected, input: {...selected.input, versionIds: [...versionIds, version(17).versionId]}}, authority), {ok: false, code: "headless.result-too-large"});
  assert.deepEqual(await queries.execute({...selected, input: {...selected.input, versionIds: [versionIds[0], versionIds[0]]}}, authority), {ok: false, code: "headless.result-too-large"});
  assert.equal(readCount(), before);
  assert.deepEqual(await queries.execute({...selected, input: {...selected.input, versionIds: [normalizeDatasetVersionId("unknown")]}}, authority),
    {ok: false, code: "headless.not-found"});
  const comparison = await queries.execute(compare, authority);
  assert.ok(comparison.ok && comparison.operation === "data.compare-dataset-versions");
  assert.equal(comparison.value.identical, false);
  assert.equal(comparison.value.rowDelta, 0);
  assert.equal(comparison.value.changedArtifactRoles.length, 4);
  assert.ok(!/private|artifactKey|recipeSnapshot/.test(JSON.stringify(comparison)));
  const same = await queries.execute({...compare, input: {...compare.input, toVersionId: compare.input.fromVersionId}}, authority);
  assert.ok(same.ok && same.operation === "data.compare-dataset-versions" && same.value.identical);
  await repository.createVersion({...version(21), datasetId: normalizeDatasetId("different-dataset")});
  assert.deepEqual(await queries.execute({...compare, input: {...compare.input, toVersionId: version(21).versionId}}, authority), {ok: false, code: "headless.not-found"});
});

test("withdrawal between point reads suppresses the partial result and prevents the next storage admission", async () => {
  const {queries, readCount} = await fixture(2);
  const request = {...selected, input: {...selected.input, versionIds: [version(1).versionId, version(2).versionId]}};
  let checks = 0;
  assert.deepEqual(await queries.execute(request, {context, stillAllowed: async () => ++checks < 3}), denied);
  assert.equal(readCount(), 1);
  for (const request of [selected, compare]) {
    assert.deepEqual(await queries.execute(request, {context, stillAllowed: async () => false}), denied);
    assert.deepEqual(await queries.execute(request, {context: {...context, workspaceId: "foreign"}, stillAllowed: async () => true}), denied);
  }
});

test("foreign or malformed records cannot become a partial successful batch and private failures stay fixed", async () => {
  const base = await fixture(2), authority = {context, stillAllowed: async () => true};
  for (const record of [
    {...version(1), workspaceId: createWorkspaceId("foreign")},
    {...version(1), datasetId: normalizeDatasetId("foreign")},
    {...version(1), versionId: version(2).versionId}, {...version(1), totalRows: -1},
  ]) {
    const queries = new ReadHeadlessDatasetMetadataUseCase({versions: {async execute() {return record;}}, comparisons: base.comparisons});
    assert.equal((await queries.execute(selected, authority)).ok, false);
  }
  const queries = new ReadHeadlessDatasetMetadataUseCase({versions: {async execute() {throw new Error("Synthetic private detail");}}, comparisons: base.comparisons});
  assert.deepEqual(await queries.execute(selected, authority), {ok: false, code: "headless.unavailable"});
  assert.deepEqual(await queries.execute(selected, {...authority, stillAllowed: () => {throw new Error("Synthetic policy failure");}}), denied);
});
