import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, mkdir, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {readModelDownloadSource} from "../../../../contracts/model";
import {captureModelManifestPayload} from "../client/modelDownloadManifest";
import {createPythonRuntimeHttpClient} from "../client/createPythonRuntimeHttpClient";
import {createPythonRuntimeTaskRegistryAdapter} from "../createPythonRuntimeTaskRegistryAdapter";
import {TaskType} from "../../../../contracts/runtime";
import {createWorkspaceId} from "../../../../contracts/workspace";
import type {PythonRuntimePort} from "../../../../application/ports/runtime";

const revision = "a".repeat(40), modelId = "fixture/model", auth = "synthetic-manifest-runtime-credential";
function payload() {
  const source = readModelDownloadSource({provider: "huggingface", modelId, revision, format: "transformers-safetensors",
    license: {kind: "provider-declared", identifier: "apache-2.0"},
    files: ["config.json", "model.safetensors", "tokenizer.json"].map(name => ({path: name, sizeBytes: 10,
      integrity: {algorithm: name.endsWith("safetensors") ? "sha256" : "git-blob-sha1", digest: "b".repeat(name.endsWith("safetensors") ? 64 : 40)}})),
    totalBytes: 30, excludedFileCount: 1, sourceVerification: "provider-metadata", bytesVerification: "not-checked", runtimeReadiness: "not-checked"},
    {provider: "huggingface", modelId, revision});
  return {provider: "transformers" as const, modelId, revision, sourceManifest: {source,
    manifestDigest: "sha256:" + createHash("sha256").update(JSON.stringify(source)).digest("hex")}};
}
const capability = "ensure-model-download.source-manifest-v1";
const response = (value: unknown) => ({ok: true, status: 200, json: async () => value});

test("generic model requests cannot grant private transfer data or trigger its getters", async () => {
  let getters = 0, traps = 0;
  const inherited = Object.assign(Object.create({sourceTransfer: {}}), payload());
  const accessor = {...payload()};
  Object.defineProperty(accessor, "sourceTransfer", {get() {getters++; return {};}});
  const prototypeProxy = new Proxy({}, {has() {traps++; return true;}, getOwnPropertyDescriptor() {traps++; return undefined;}});
  const proxiedPrototype = Object.assign(Object.create(prototypeProxy), payload());
  for (const input of [{...payload(), sourceTransfer: null}, {...payload(), sourceTransfer: {}},
    {provider: "transformers", modelId, sourceTransfer: {}}, inherited, accessor, proxiedPrototype]) {
    let calls = 0;
    const client = createPythonRuntimeHttpClient({baseUrl: "http://127.0.0.1:43111", authorizationToken: auth,
      fetchImplementation: (async () => {calls++; throw new Error("No transport");}) as never});
    await assert.rejects(client.startTask({requestId: "private-transfer-denied", taskType: "ensure-model-download", payload: input}));
    await assert.rejects(client.ensureModelDownloaded(input as never));
    assert.equal(calls, 0);
  }
  assert.equal(getters, 0); assert.equal(traps, 0);
});

test("normalized manifest digest retains the independently checked Python wire vector", () => {
  assert.equal(payload().sourceManifest.manifestDigest, "sha256:13c6493fcd0112708cb2bf37b4aebb2124ae07c40ce41dfa85614fc5d533d8e9");
});

test("ordinary model payloads reject serialization hooks and late getters before any IO", async () => {
  let hooks = 0, getters = 0, traps = 0;
  const injected = {provider: "transformers", modelId, sourceTransfer: {version: "synthetic-marker"}};
  const ownHook = {provider: "transformers", modelId, toJSON() {hooks++; return injected;}};
  const callableHook = Object.assign(() => undefined, {toJSON() {hooks++; return injected;}});
  const inheritedHook = Object.assign(Object.create({toJSON() {hooks++; return injected;}}), {provider: "transformers", modelId});
  const revisionGetter = {provider: "transformers", modelId};
  Object.defineProperty(revisionGetter, "revision", {enumerable: true, get() {
    getters++; Object.assign(revisionGetter, {sourceTransfer: {}}); return undefined;
  }});
  const nestedProxy = {provider: "transformers", modelId, taskTags: [new Proxy({}, {
    getPrototypeOf() {traps++; return Object.prototype;}, ownKeys() {traps++; return [];},
  })]};
  for (const input of [ownHook, callableHook, inheritedHook, revisionGetter, nestedProxy]) {
    let calls = 0;
    const client = createPythonRuntimeHttpClient({baseUrl: "http://127.0.0.1:43111", authorizationToken: auth,
      fetchImplementation: (async () => {calls++; throw new Error("No transport");}) as never});
    await assert.rejects(client.startTask({requestId: "ordinary-hooks-denied", taskType: "ensure-model-download", payload: input}));
    await assert.rejects(client.ensureModelDownloaded(input as never));
    assert.equal(calls, 0);
  }
  assert.equal(hooks, 0); assert.equal(getters, 0); assert.equal(traps, 0);
});

test("ordinary Model JSON shape is detached and frozen before capability waits and serialization", async () => {
  const input = {provider: "transformers", modelId, revision, taskTags: ["text-generation"], inferenceMode: undefined};
  const selected = captureModelManifestPayload(input);
  assert.notEqual(selected.payload, input); assert.ok(Object.isFrozen(selected.payload));
  assert.ok(Object.isFrozen(selected.payload.taskTags));
  assert.equal(JSON.stringify(selected.payload), JSON.stringify(input));
  let entered!: () => void, release!: () => void, posts = 0;
  const started = new Promise<void>(resolve => {entered = resolve;});
  const held = new Promise<void>(resolve => {release = resolve;});
  const client = createPythonRuntimeHttpClient({baseUrl: "http://127.0.0.1:43111", authorizationToken: auth,
    fetchImplementation: (async (url: unknown, options?: RequestInit) => {
      if (String(url).endsWith("/capabilities")) {entered(); await held; return response({runtimeId: "synthetic-runtime",
        capabilities: ["ensure-model-download.exact-revision-v1"]});}
      posts++; const body = JSON.parse(String(options?.body));
      assert.deepEqual(body.payload, {provider: "transformers", modelId, revision, taskTags: ["text-generation"]});
      assert.equal(body.requestId, "ordinary-owned-copy");
      return response({requestId: body.requestId, taskType: "ensure-model-download", accepted: true, status: "queued"});
    }) as never});
  const operation = client.startTask({requestId: "ordinary-owned-copy", taskType: "ensure-model-download", payload: input});
  await started;
  input.modelId = "fixture/changed"; input.taskTags.push("changed");
  Object.assign(input, {sourceTransfer: {}, toJSON() {return {sourceTransfer: {}};}});
  release(); await operation; assert.equal(posts, 1);
  assert.equal(selected.payload.modelId, modelId); assert.deepEqual(selected.payload.taskTags, ["text-generation"]);
});

test("strict source presence rejects malformed, forged or executable data before any transport", async () => {
  const original = payload();
  for (const input of [{...original, sourceManifest: null}, {...original, sourceManifest: undefined},
    {...original, revision: undefined}, {...original, modelId: "fixture/other"},
    {...original, artifactForm: "adapter"}, {...original, sourceManifest: {...original.sourceManifest, manifestDigest: "sha256:" + "f".repeat(64)}},
    {...original, sourceManifest: {...original.sourceManifest, privateKey: "synthetic-marker"}}]) {
    let calls = 0;
    const client = createPythonRuntimeHttpClient({baseUrl: "http://127.0.0.1:43111", authorizationToken: auth,
      fetchImplementation: (async () => {calls++; throw new Error("No dispatch");}) as never});
    await assert.rejects(client.startTask({requestId: "manifest-denied", taskType: "ensure-model-download", payload: input}));
    assert.equal(calls, 0);
  }
  let getters = 0;
  const accessor = {...original};
  Object.defineProperty(accessor, "sourceManifest", {get() {getters++; return original.sourceManifest;}});
  assert.throws(() => captureModelManifestPayload(accessor)); assert.equal(getters, 0);
});

test("both private download entry points deny an older worker before task POST", async () => {
  for (const synchronous of [false, true]) {
    const urls: string[] = [];
    const client = createPythonRuntimeHttpClient({baseUrl: "http://127.0.0.1:43111", authorizationToken: auth,
      fetchImplementation: (async (url: unknown) => {urls.push(String(url)); return response({runtimeId: "synthetic-runtime",
        capabilities: ["ensure-model-download.exact-revision-v1"]});}) as never});
    const promise = synchronous ? client.ensureModelDownloaded(payload()) : client.startTask({requestId: "manifest-old-worker",
      taskType: "ensure-model-download", payload: payload()});
    await assert.rejects(promise, /Exact model file downloads are unavailable/);
    assert.equal(urls.length, 1); assert.ok(urls[0]!.endsWith("/capabilities"));
  }
});

test("source targets stay detached across held capability checks and exact completion is required", async () => {
  const cache = await mkdtemp(path.join(tmpdir(), "manifest-client-"));
  const handle = `models--fixture--model/snapshots/${revision}`;
  await mkdir(path.join(cache, ...handle.split("/")), {recursive: true});
  try {
    for (const proof of ["matching", "missing", "wrong", "foreign-repository", "foreign-revision"] as const) {
      const input = payload(), expected = structuredClone(input);
      let entered!: () => void, release!: () => void, requestId = "", posts = 0;
      const started = new Promise<void>(resolve => {entered = resolve;});
      const held = new Promise<void>(resolve => {release = resolve;});
      const client = createPythonRuntimeHttpClient({baseUrl: "http://127.0.0.1:43111", authorizationToken: auth,
        modelDownloadPollIntervalMs: 1, environment: {HF_HUB_CACHE: cache}, fetchImplementation: (async (url: unknown, options?: RequestInit) => {
          if (String(url).endsWith("/capabilities")) {entered(); await held; return response({runtimeId: "synthetic-runtime",
            capabilities: ["ensure-model-download.exact-revision-v1", capability]});}
          if (String(url).endsWith("/tasks/start")) {
            posts++; const body = JSON.parse(String(options?.body)); requestId = body.requestId;
            assert.deepEqual(body.payload, expected);
            return response({requestId, taskType: "ensure-model-download", accepted: true, status: "queued"});
          }
          return response({requestId, taskType: "ensure-model-download", status: "succeeded", data: {
            provider: "transformers", modelId, revision, downloaded: false, fromCache: true,
            modelHandle: proof === "foreign-repository" ? handle.replace("fixture--model", "fixture--other") :
              proof === "foreign-revision" ? handle.replace(revision, "b".repeat(40)) : handle,
            ...(proof === "missing" ? {} : {verifiedManifestDigest: proof === "wrong" ? "sha256:" + "f".repeat(64) : expected.sourceManifest.manifestDigest})}});
        }) as never});
      const operation = client.ensureModelDownloaded(input);
      await started;
      input.modelId = "fixture/changed"; input.revision = "b".repeat(40);
      (input.sourceManifest.source.files[0] as {sizeBytes: number}).sizeBytes++;
      release();
      if (proof === "matching") assert.equal((await operation).verifiedManifestDigest, expected.sourceManifest.manifestDigest);
      else await assert.rejects(operation, /selected model files could not be verified/);
      assert.equal(posts, 1);
    }
  } finally {
    const relative = path.relative(path.resolve(tmpdir()), cache);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    await rm(cache, {recursive: true, force: true});
  }
});

test("worker ownership withdrawal during capability validation cannot dispatch the manifest", async () => {
  let current = true, calls = 0;
  const client = createPythonRuntimeHttpClient({baseUrl: "http://127.0.0.1:43111", authorizationToken: auth,
    captureProcessOwnership: () => () => {if (!current) throw new Error("Synthetic worker withdrawn");},
    fetchImplementation: (async () => {calls++; current = false; return response({runtimeId: "synthetic-runtime",
      capabilities: ["ensure-model-download.exact-revision-v1", capability]});}) as never});
  await assert.rejects(client.startTask({requestId: "manifest-withdrawn", taskType: "ensure-model-download", payload: payload()}), /worker withdrawn/);
  assert.equal(calls, 1);
});

test("private async completion needs its accepted manifest and checks proof before any handle resolution", async () => {
  const selected = payload(), expected = selected.sourceManifest;
  const client = createPythonRuntimeHttpClient({baseUrl: "http://127.0.0.1:43111", authorizationToken: auth,
    environment: {HF_HUB_CACHE: path.join(tmpdir(), "uncreated-manifest-cache")}});
  const base = {provider: "transformers", modelId, revision, modelHandle: `models--fixture--model/snapshots/${revision}`,
    downloaded: false, fromCache: true};
  await assert.rejects(client.resolveModelDownloadTaskResult({...base, verifiedManifestDigest: expected.manifestDigest}), /accepted source manifest/);
  for (const value of [base, {...base, verifiedManifestDigest: "sha256:" + "f".repeat(64)},
    {...base, modelId: "fixture/other", verifiedManifestDigest: expected.manifestDigest},
    {...base, modelHandle: base.modelHandle.replace("fixture--model", "fixture--other"), verifiedManifestDigest: expected.manifestDigest},
    {...base, modelHandle: base.modelHandle.replace(revision, "b".repeat(40)), verifiedManifestDigest: expected.manifestDigest}])
    await assert.rejects(client.resolveModelDownloadTaskResult(value, expected), /selected model files could not be verified/);
});

test("actual task registry binds a frozen original manifest across readiness and asynchronous completion", async () => {
  const workspaceId = createWorkspaceId("manifest-registry-workspace");
  const cache = await mkdtemp(path.join(tmpdir(), "manifest-registry-"));
  const handle = `models--fixture--model/snapshots/${revision}`;
  await mkdir(path.join(cache, ...handle.split("/")), {recursive: true});
  try {
    for (const proof of ["matching", "missing", "wrong"] as const) {
      const input = payload(), expected = structuredClone(input);
      let entered!: () => void, release!: () => void, requestId = "";
      const started = new Promise<void>(resolve => {entered = resolve;});
      const held = new Promise<void>(resolve => {release = resolve;});
      const client = createPythonRuntimeHttpClient({baseUrl: "http://127.0.0.1:43111", authorizationToken: auth,
        environment: {HF_HUB_CACHE: cache}, fetchImplementation: (async (url: unknown, options?: RequestInit) => {
          if (String(url).endsWith("/capabilities")) return response({runtimeId: "synthetic-runtime",
            capabilities: ["ensure-model-download.exact-revision-v1", capability]});
          if (String(url).endsWith("/tasks/start")) {
            const body = JSON.parse(String(options?.body)); requestId = body.requestId;
            assert.deepEqual(body.payload, expected); assert.equal(body.metadata.workspaceId, workspaceId);
            return response({requestId, taskType: "ensure-model-download", accepted: true, status: "queued", metadata: {workspaceId}});
          }
          return response({requestId, taskType: "ensure-model-download", status: "succeeded", metadata: {workspaceId}, data: {
            provider: "transformers", modelId, revision, downloaded: false, fromCache: true, modelHandle: handle,
            ...(proof === "missing" ? {} : {verifiedManifestDigest: proof === "matching" ? expected.sourceManifest.manifestDigest : "sha256:" + "f".repeat(64)})}});
        }) as never});
      const registry = createPythonRuntimeTaskRegistryAdapter(client as PythonRuntimePort, {
        async ensureRuntimeReady(request) {
          assert.ok(Object.isFrozen(request.payload));
          assert.ok(Object.isFrozen((request.payload as typeof input).sourceManifest.source.files));
          entered(); await held;
        },
      });
      const request = {requestId: "manifest-registry-" + proof, workspaceId, taskType: TaskType.MODEL_DOWNLOAD,
        payload: input, metadata: {workspaceId: workspaceId as string}};
      const operation = registry.startTask(request);
      await started;
      input.modelId = "fixture/changed"; request.metadata.workspaceId = "different-workspace";
      release(); await operation;
      if (proof === "matching") {
        const status = await registry.getTaskStatus(request.requestId);
        assert.equal((await registry.readCompletedModelDownload(request.requestId))?.verifiedManifestDigest, expected.sourceManifest.manifestDigest);
        assert.doesNotMatch(JSON.stringify(status), /sourceManifest|modelHandle|localPath|verifiedManifestDigest/);
      } else await assert.rejects(registry.getTaskStatus(request.requestId), /selected model files could not be verified/);
    }
  } finally {
    const relative = path.relative(path.resolve(tmpdir()), cache);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    await rm(cache, {recursive: true, force: true});
  }
});
