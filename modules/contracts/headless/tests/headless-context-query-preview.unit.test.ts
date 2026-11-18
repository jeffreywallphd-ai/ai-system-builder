import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {createWorkspaceId, WORKSPACE_ID_MAX_LENGTH} from "../../workspace";
import {HEADLESS_CONTRACT_VERSION as version, HEADLESS_CONTEXT_QUERY_MAX_CHARACTERS,
  readHeadlessContextQueryPreviewRequest, readHeadlessContextQueryPreviewValue,
  type HeadlessHostIncarnationId} from "..";

const hostIncarnationId = "4bad63da-cf35-4a3f-aad3-b00c4c4eca40" as HeadlessHostIncarnationId;
const workspaceId = createWorkspaceId("workspace.synthetic");
const reference = {workspaceId, contextId: "317d5bb8-9cf8-4245-8c64-d37910c9cfa6",
  taskId: "98861a77-36ee-4691-975f-8c8677257d1e", kind: "rag-database" as const, artifactDigest: "sha256:" + "a".repeat(64)};
const input = {hostIncarnationId, workspaceId, reference, query: "What is the release policy?", maximumResults: 5, embeddingDevice: "cpu" as const};
const request = {version, operation: "context.preview-query" as const, input};
const sha = (text: string) => "sha256:" + createHash("sha256").update(text, "utf8").digest("hex");
const preview = () => ({reference: {...reference}, queryDigest: sha(input.query), maximumResults: 5, embeddingDevice: "cpu",
  modelRecordId: "model.embedding", modelUpdatedAt: "2026-11-18T00:00:00.000Z", sourceCount: 2,
  maximumQueryCharacters: HEADLESS_CONTEXT_QUERY_MAX_CHARACTERS, byteAvailability: "not-checked", runtimeReadiness: "not-checked",
  approvalRequired: true, output: "citation-summary"});

test("query preview preserves exact transient Unicode text within the existing headless envelope", () => {
  for (const query of [input.query, "policy\n\tRelease café 📄", "界".repeat(HEADLESS_CONTEXT_QUERY_MAX_CHARACTERS), '"'.repeat(HEADLESS_CONTEXT_QUERY_MAX_CHARACTERS)]) {
    const workspaceId = createWorkspaceId("w".repeat(WORKSPACE_ID_MAX_LENGTH));
    const candidate = {...request, input: {...input, workspaceId, reference: {...reference, workspaceId}, query}};
    assert.deepEqual(readHeadlessContextQueryPreviewRequest(candidate, hostIncarnationId), {ok: true, request: candidate});
    assert.ok(Buffer.byteLength(JSON.stringify(candidate), "utf8") <= 8 * 1024, "Do not widen the headless request guard.");
  }
  const parsed = readHeadlessContextQueryPreviewRequest(request, hostIncarnationId); assert.ok(parsed.ok);
  assert.notStrictEqual(parsed.request.input.reference, reference);
});

test("query preview rejects invalid or excessive text, references, devices, results and accessors before admission", () => {
  let reads = 0;
  for (const changed of [{query: ""}, {query: " spaced "}, {query: "x".repeat(2001)}, {query: "bad\u0000text"}, {query: "bad\ud800text"},
    {maximumResults: 0}, {maximumResults: 21}, {maximumResults: 1.2}, {maximumResults: "5"}, {embeddingDevice: "auto"},
    {reference: {...reference, kind: "markdown-context-pack"}}, {reference: {...reference, workspaceId: createWorkspaceId("another")}},
    {reference: {...reference, path: "private/source"}}, {modelPath: "private/model"}])
    assert.equal(readHeadlessContextQueryPreviewRequest({...request, input: {...input, ...changed}}, hostIncarnationId).ok, false);
  const getter = Object.defineProperty({...input}, "query", {enumerable: true, get() {reads++; return input.query;}});
  assert.equal(readHeadlessContextQueryPreviewRequest({...request, input: getter}, hostIncarnationId).ok, false);
  assert.equal(reads, 0);
  assert.deepEqual(readHeadlessContextQueryPreviewRequest(request, "6e95cc2e-1587-409a-995f-223ff7e3dbaa" as HeadlessHostIncarnationId),
    {ok: false, code: "headless.host-changed"});
});

test("preview results bind the exact locally computed hash and preserve approval/readiness without raw text", () => {
  assert.deepEqual(readHeadlessContextQueryPreviewValue(preview(), input, sha(input.query)), preview());
  for (const changed of [{queryDigest: sha("other question")}, {reference: {...reference, taskId: hostIncarnationId}},
    {maximumResults: 4}, {embeddingDevice: "cuda"}, {sourceCount: 5}, {sourceCount: 0}, {modelRecordId: ""},
    {modelUpdatedAt: "invalid"}, {maximumQueryCharacters: 4000}, {approvalRequired: false}, {byteAvailability: "ready"},
    {runtimeReadiness: "ready"}, {output: "raw-results"}, {query: input.query}, {modelPath: "private/model"}, {embeddings: [1]}])
    assert.equal(readHeadlessContextQueryPreviewValue({...preview(), ...changed}, input, sha(input.query)), undefined);
  assert.equal(readHeadlessContextQueryPreviewValue(preview(), input, "invalid"), undefined);
  assert.doesNotMatch(JSON.stringify(preview()), /What is the release policy|private\/model|"query":/);
});
