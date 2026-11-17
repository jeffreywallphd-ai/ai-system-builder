import assert from "node:assert/strict";
import test from "node:test";
import {normalizeDatasetId, normalizeDatasetVersionId} from "../../dataset";
import {createWorkspaceId} from "../../workspace";
import {HEADLESS_CONTRACT_VERSION, parseHeadlessReadRequest, type HeadlessHostIncarnationId} from "../headless-read-request";
import {readHeadlessDatasetVersionBatch, readHeadlessDatasetComparison, type HeadlessDatasetVersionSummary} from "../headless-dataset-metadata";

const hostIncarnationId = "e14c2b3d-249f-47d9-b742-838044a95182" as HeadlessHostIncarnationId;
const workspaceId = createWorkspaceId("workspace.synthetic"), datasetId = normalizeDatasetId("dataset.synthetic");

const versionId = normalizeDatasetVersionId("version.001");
const target = {hostIncarnationId, workspaceId, datasetId, versionIds: [versionId]};
const fingerprint = `sha256:${"a".repeat(64)}` as const;
const summary: HeadlessDatasetVersionSummary = {versionId, versionDigest: fingerprint, createdAt: "2026-11-17T00:00:00.000Z",
  totalRows: 10, sourceCount: 1, artifactCount: 4, parentVersionId: null, splitSeed: 42, recipeDigest: fingerprint,
  quality: {policyFingerprint: fingerprint, reportFingerprint: fingerprint},
  splits: [{role: "train", rowCount: 6}, {role: "validation", rowCount: 2}, {role: "test", rowCount: 2}]};
const page = {workspaceId, datasetId, versions: [summary]};
const compareTarget = {hostIncarnationId, workspaceId, fromVersionId: versionId, toVersionId: normalizeDatasetVersionId("version.002")};
const comparison = {fromVersionId: versionId, toVersionId: compareTarget.toVersionId, identical: false, rowDelta: 2,
  sources: {added: 1, removed: 0, changed: 0}, changedArtifactRoles: ["dataset"], recipeChanged: false,
  qualityPolicyChanged: false, documentationChanged: false};

test("dataset query requests are exact passive targets and carry no source, identity or path authority", () => {
  for (const [operation, input] of [["data.dataset-versions", target], ["data.compare-dataset-versions", compareTarget]] as const) {
    const request = {version: HEADLESS_CONTRACT_VERSION, operation, input};
    assert.deepEqual(parseHeadlessReadRequest(request, hostIncarnationId), {ok: true, request});
    for (const extra of [{path: "private-source"}, {organizationId: "foreign"}, {payload: "synthetic"}]) {
      assert.deepEqual(parseHeadlessReadRequest({...request, input: {...input, ...extra}}, hostIncarnationId), {ok: false, code: "headless.invalid-request"});
    }
  }
  for (const datasetId of ["../private", "dataset.synthetic ", "https://example.invalid/data", null]) {
    assert.equal(parseHeadlessReadRequest({version: HEADLESS_CONTRACT_VERSION, operation: "data.dataset-versions",
      input: {...target, datasetId}}, hostIncarnationId).ok, false);
  }
});

test("batches preserve exact dataset identity, requested order and bounded complete metadata", () => {
  assert.deepEqual(readHeadlessDatasetVersionBatch(page, target), page);
  for (const invalid of [
    {...page, datasetId: "foreign"}, {...page, workspaceId: "foreign"}, {...page, extra: true},
    {...page, versions: [{...summary, artifactKey: "private"}]}, {...page, versions: [{...summary, totalRows: -1}]},
    {...page, versions: [{...summary, sourceCount: 101}]}, {...page, versions: [{...summary, createdAt: "private"}]},
    {...page, versions: [{...summary, quality: {...summary.quality, details: "private"}}]},
    {...page, versions: [{...summary, splits: [{role: "train", rowCount: 11}, ...summary.splits.slice(1)]}]},
    {...page, versions: [{...summary, splits: [{role: "train", rowCount: 8}, ...summary.splits.slice(1)]}]},
    {...page, versions: [{...summary, splits: [{role: "train", rowCount: 8}, {role: "validation", rowCount: 8}, {role: "test", rowCount: null}]}]},
    {...page, versions: [summary, summary]}, {...page, nextAfterVersionId: versionId},
    {...page, versions: Array.from({length: 17}, () => summary)},
  ]) assert.equal(readHeadlessDatasetVersionBatch(invalid, target), undefined);
  assert.equal(readHeadlessDatasetVersionBatch(page, {...target, versionIds: [normalizeDatasetVersionId("foreign")]}), undefined);
  assert.equal(readHeadlessDatasetVersionBatch(page, {...target, versionIds: []}), undefined);
  assert.equal(readHeadlessDatasetVersionBatch({...page, versions: [summary, summary]}, {...target, versionIds: [versionId, versionId]}), undefined);
  const noCounts = {...page, versions: [{...summary, splitSeed: null, splits: summary.splits.map(item => ({...item, rowCount: null}))}]};
  assert.deepEqual(readHeadlessDatasetVersionBatch(noCounts, target), noCounts);
});

test("comparison replies match both exact versions and contain only bounded flags, counts and finite roles", () => {
  assert.deepEqual(readHeadlessDatasetComparison(comparison, compareTarget), comparison);
  assert.equal(readHeadlessDatasetComparison({...comparison, toVersionId: versionId}, {...compareTarget, toVersionId: versionId}), undefined);
  for (const invalid of [
    {...comparison, fromVersionId: "foreign"}, {...comparison, toVersionId: "foreign"}, {...comparison, path: "private"},
    {...comparison, rowDelta: Number.MAX_SAFE_INTEGER + 1}, {...comparison, recipeChanged: "yes"},
    {...comparison, sources: {added: 101, removed: 0, changed: 0}}, {...comparison, sources: {added: 1, removed: 0, changed: 100}},
    {...comparison, changedArtifactRoles: ["dataset", "dataset"]}, {...comparison, changedArtifactRoles: ["private"]},
  ]) assert.equal(readHeadlessDatasetComparison(invalid, compareTarget), undefined);
  let getters = 0;
  const malicious = {...page};
  Object.defineProperty(malicious, "versions", {enumerable: true, get() {getters++; return [];}});
  assert.equal(readHeadlessDatasetVersionBatch(malicious, target), undefined);
  assert.equal(getters, 0);
});
