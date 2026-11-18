import assert from "node:assert/strict";
import test from "node:test";
import {createWorkspaceId} from "../../workspace";
import {HEADLESS_CONTRACT_VERSION as version, readHeadlessContextRebuildRequest, readHeadlessContextRebuildValue,
  type HeadlessHostIncarnationId} from "..";

const hostIncarnationId = "4bad63da-cf35-4a3f-aad3-b00c4c4eca40" as HeadlessHostIncarnationId;
const workspaceId = createWorkspaceId("workspace.synthetic");
const reference = {workspaceId, contextId: "317d5bb8-9cf8-4245-8c64-d37910c9cfa6",
  taskId: "98861a77-36ee-4691-975f-8c8677257d1e", kind: "markdown-context-pack" as const, artifactDigest: "sha256:" + "a".repeat(64)};
const input = {hostIncarnationId, workspaceId, reference};
const request = {version, operation: "context.preview-rebuild" as const, input};
function preview() {
  return {reference: {...reference}, preview: {workspaceId, name: "Synthetic Context", sources: [{reference: {
    kind: "ingestion-file", taskId: "source.task", fileId: "source.file", taskRevision: 1},
    digest: "sha256:" + "b".repeat(64), sizeBytes: 20, format: "csv", licenseStatus: "unknown"}],
    settings: {kind: "markdown-context-pack", chunkCharacters: 512, overlapCharacters: 0, maximumChunks: 100,
      textFields: ["text"], cleaningPreset: "standard"}, totalBytes: 20,
    runtimeReadiness: "not-checked", approvalRequired: true, reviewRequired: true, modelCalls: 0, externalProviderCalls: 0},
    byteAvailability: "not-checked"};
}

test("rebuild preview accepts exact saved references and preserves passive approval/readiness facts", () => {
  assert.deepEqual(readHeadlessContextRebuildRequest(request, hostIncarnationId), {ok: true, request});
  assert.deepEqual(readHeadlessContextRebuildValue(preview(), input), preview());
});

test("rebuild requests reject cross-workspace, forged, private and unknown fields", () => {
  const invalid = [
    {...request, input: {...input, workspaceId: "workspace.other"}},
    {...request, input: {...input, reference: {...reference, taskId: "not-a-task"}}},
    {...request, input: {...input, reference: {...reference, artifactDigest: "wrong"}}},
    {...request, input: {...input, reference: {...reference, path: "synthetic-private-path"}}},
    {...request, input: {...input, idempotencyKey: reference.taskId}},
    {...request, query: "not a query capability"},
  ];
  for (const value of invalid) assert.equal(readHeadlessContextRebuildRequest(value, hostIncarnationId).ok, false);
  assert.deepEqual(readHeadlessContextRebuildRequest(request,
    "94b88553-7889-4b77-b283-a124b6977e9b" as HeadlessHostIncarnationId), {ok: false, code: "headless.host-changed"});
});

test("rebuild result codecs reject changed identity, active claims, excessive sources and private fields", () => {
  const value = preview();
  const invalid = [
    {...value, reference: {...reference, contextId: reference.taskId}},
    {...value, reference: {...reference, artifactDigest: "sha256:" + "c".repeat(64)}},
    {...value, byteAvailability: "verified"},
    {...value, originalActor: "must stay private"},
    {...value, preview: {...value.preview, runtimeReadiness: "ready"}},
    {...value, preview: {...value.preview, modelCalls: 1}},
    {...value, preview: {...value.preview, approvalRequired: false}},
    {...value, preview: {...value.preview, totalBytes: 21}},
    {...value, preview: {...value.preview, localModelReference: "must stay private"}},
    {...value, preview: {...value.preview, sources: [{...value.preview.sources[0], storageKey: "must stay private"}]}},
    {...value, preview: {...value.preview, sources: Array.from({length: 5}, () => value.preview.sources[0])}},
  ];
  for (const candidate of invalid) assert.equal(readHeadlessContextRebuildValue(candidate, input), undefined);
});

test("rebuild request copying rejects accessors without invoking them", () => {
  let reads = 0;
  const hostile = {...request, input: {...input}};
  Object.defineProperty(hostile.input, "reference", {enumerable: true, get() {reads++; throw new Error("private accessor");}});
  assert.equal(readHeadlessContextRebuildRequest(hostile, hostIncarnationId).ok, false);
  assert.equal(reads, 0);
});
