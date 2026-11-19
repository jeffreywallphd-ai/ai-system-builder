import assert from "node:assert/strict";
import test from "node:test";
import {MAX_MODEL_SOURCE_BYTES, MAX_MODEL_SOURCE_FILES, readModelDownloadSource, readModelDownloadSourceRequest,
  type ModelDownloadSource} from "..";

const request = {provider: "huggingface", modelId: "Qwen/synthetic-model", revision: "a".repeat(40)} as const;
const file = (path: string, sizeBytes = 10) => ({path, sizeBytes,
  integrity: {algorithm: path.endsWith(".safetensors") ? "sha256" : "git-blob-sha1", digest: "b".repeat(path.endsWith(".safetensors") ? 64 : 40)}});
const source = () => ({...request, format: "transformers-safetensors", license: {kind: "provider-declared", identifier: "apache-2.0"},
  files: [file("tokenizer.json"), file("config.json"), file("model.safetensors")], totalBytes: 30, excludedFileCount: 2,
  sourceVerification: "provider-metadata", bytesVerification: "not-checked", runtimeReadiness: "not-checked"});

test("source codecs capture strict targets and sort detached exact source metadata without granting other checks", () => {
  const input = {...request, modelId: request.modelId as string}, raw = source();
  const normalized = readModelDownloadSourceRequest(input), result = readModelDownloadSource(raw, input);
  input.modelId = "Qwen/changed";
  raw.files[0].path = "changed.json";
  assert.equal(normalized.modelId, request.modelId);
  assert.deepEqual(result.files.map(item => item.path), ["config.json", "model.safetensors", "tokenizer.json"]);
  assert.equal(result.bytesVerification, "not-checked");
  assert.deepEqual(readModelDownloadSource({...source(), license: {kind: "unknown"}}, request).license, {kind: "unknown"});
  assert.deepEqual(readModelDownloadSourceRequest({provider: "huggingface", modelId: request.modelId}),
    {provider: "huggingface", modelId: request.modelId});
});

test("malformed, executable, credential-shaped, accessor, branch and ambiguous target requests refuse", () => {
  const candidates: unknown[] = [null, {...request, provider: "other"}, {...request, extra: true},
    {...request, modelId: "https://example.invalid/model"}, {...request, modelId: "Qwen/../model"},
    {...request, modelId: "Qwen/hf_" + "x".repeat(20)}, {...request, modelId: "Qwen/model\n"},
    ...[null, undefined, "main", "A".repeat(40), "a".repeat(40) + "\n"].map(revision => ({...request, revision})),
    Object.defineProperty({...request}, "modelId", {get() {assert.fail("Do not evaluate accessors");}, enumerable: true})];
  for (const raw of candidates) assert.throws(() => readModelDownloadSourceRequest(raw));
});

test("source bytes, file set, digests and declared license remain distinct, exact and bounded", () => {
  const original = source();
  const candidates = [
    {...original, modelId: "Qwen/other"}, {...original, revision: "b".repeat(40)},
    {...original, runtimeReadiness: "ready"}, {...original, bytesVerification: "verified"},
    {...original, sourceVerification: "authentic"}, {...original, localPath: "private-path"},
    {...original, totalBytes: 31}, {...original, totalBytes: NaN},
    {...original, excludedFileCount: 257}, {...original, excludedFileCount: -1},
    {...original, license: {kind: "unknown", identifier: "apache-2.0"}},
    {...original, license: {kind: "provider-declared", identifier: "private license text"}},
    {...original, files: original.files.filter(item => item.path !== "config.json")},
    {...original, files: [...original.files, file("model.bin")]},
    {...original, files: [...original.files, file("model.py")]},
    {...original, files: [...original.files, file("../config.json")]},
    {...original, files: [...original.files, file("CON.safetensors")]},
    {...original, files: [...original.files, file("config.json")]},
    {...original, files: [file("config.json"), file("tokenizer.json"), {...file("model.safetensors"), integrity: {algorithm: "git-blob-sha1", digest: "a".repeat(40)}}]},
    {...original, files: [file("config.json"), file("tokenizer.json"), {...file("model.safetensors"), integrity: {algorithm: "sha256", digest: "A".repeat(64)}}]},
    {...original, files: Array.from({length: MAX_MODEL_SOURCE_FILES + 1}, (_, i) => file(`model-${i}.safetensors`))},
    {...original, files: [file("config.json"), file("tokenizer.json"), file("model.safetensors", MAX_MODEL_SOURCE_BYTES)], totalBytes: MAX_MODEL_SOURCE_BYTES + 20},
  ];
  for (const candidate of candidates) assert.throws(() => readModelDownloadSource(candidate, request));
});

test("a returned immutable revision can be resolved only before an exact revision is requested", () => {
  const result: ModelDownloadSource = readModelDownloadSource(source(), {provider: "huggingface", modelId: request.modelId});
  assert.equal(result.revision, request.revision);
  assert.throws(() => readModelDownloadSource({...source(), revision: "main"}, {provider: "huggingface", modelId: request.modelId}));
});
