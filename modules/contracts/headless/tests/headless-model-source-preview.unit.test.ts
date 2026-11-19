import assert from "node:assert/strict";
import test from "node:test";
import {createWorkspaceId} from "../../workspace";
import {HEADLESS_CONTRACT_VERSION as version, readHeadlessModelSourcePreviewRequest, readHeadlessModelSourcePreviewValue,
  type HeadlessHostIncarnationId} from "..";

const hostIncarnationId = "ab7fa113-6df0-45b5-8a19-6c0ea4f348cf" as HeadlessHostIncarnationId;
const workspaceId = createWorkspaceId("model.source.preview"), modelId = "Qwen/synthetic-model", revision = "a".repeat(40);
const input = {hostIncarnationId, workspaceId, modelId, revision};
const request = {version, operation: "models.preview-source", input};
const source = () => ({provider: "huggingface", modelId, revision, format: "transformers-safetensors", license: {kind: "unknown"},
  files: ["config.json", "model.safetensors", "tokenizer.json"].map(path => ({path, sizeBytes: 10,
    integrity: {algorithm: path.endsWith("safetensors") ? "sha256" : "git-blob-sha1", digest: "b".repeat(path.endsWith("safetensors") ? 64 : 40)}})),
  totalBytes: 30, excludedFileCount: 0, sourceVerification: "provider-metadata", bytesVerification: "not-checked", runtimeReadiness: "not-checked"});
const value = () => ({workspaceId, source: source(), manifestDigest: "sha256:" + "c".repeat(64), downloadApprovalRequired: true});

test("source selectors are strict copied targets and can request immutable HEAD resolution", () => {
  const mutable = {...request, input: {...input}};
  const parsed = readHeadlessModelSourcePreviewRequest(mutable, hostIncarnationId);
  assert.ok(parsed.ok); mutable.input.modelId = "Qwen/changed";
  assert.equal(parsed.request.input.modelId, modelId);
  const {revision: _revision, ...unpinned} = input;
  assert.equal(readHeadlessModelSourcePreviewRequest({...request, input: unpinned}, hostIncarnationId).ok, true);
  assert.deepEqual(readHeadlessModelSourcePreviewRequest({...request, input: {...input,
    hostIncarnationId: "39c8ea67-9724-4e9d-ad4d-570bf2fad290"}}, hostIncarnationId), {ok: false, code: "headless.host-changed"});
});

test("source selectors reject private/effect fields, alternate providers, pins and executable inputs", () => {
  for (const raw of [
    {...request, operation: "models.download"}, {...request, extra: true}, {...request, input: {...input, localPath: "private/model"}},
    {...request, input: {...input, provider: "other"}}, {...request, input: {...input, revision: "main"}},
    {...request, input: {...input, revision: null}}, {...request, input: {...input, modelId: "https://foreign.invalid/model"}},
    {...request, input: Object.defineProperty({...input}, "modelId", {get() {assert.fail("Do not read accessors");}, enumerable: true})},
  ]) assert.equal(readHeadlessModelSourcePreviewRequest(raw, hostIncarnationId).ok, false);
});

test("a structural source preview correlates its target and preserves every unperformed check", () => {
  const original = value(), decoded = readHeadlessModelSourcePreviewValue(original, input);
  assert.ok(decoded); original.source.files[0].path = "changed";
  assert.equal(decoded.source.files[0].path, "config.json");
  assert.equal(decoded.downloadApprovalRequired, true);
  assert.equal(decoded.source.bytesVerification, "not-checked");
  assert.deepEqual(decoded.source.license, {kind: "unknown"});
});

test("substituted, oversized, private, effect-authorized and ready claims refuse", () => {
  for (const raw of [
    {...value(), workspaceId: createWorkspaceId("other.workspace")}, {...value(), privateCard: "private card"},
    {...value(), manifestDigest: "c".repeat(64)}, {...value(), downloadApprovalRequired: false},
    {...value(), source: {...source(), modelId: "Qwen/other"}}, {...value(), source: {...source(), revision: "b".repeat(40)}},
    {...value(), source: {...source(), runtimeReadiness: "ready"}}, {...value(), source: {...source(), bytesVerification: "verified"}},
    {...value(), source: {...source(), files: Array.from({length: 65}, () => source().files[0])}},
  ]) assert.equal(readHeadlessModelSourcePreviewValue(raw, input), undefined);
});
