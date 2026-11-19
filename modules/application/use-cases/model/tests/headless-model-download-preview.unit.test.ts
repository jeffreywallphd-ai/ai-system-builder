import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import test from "node:test";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {readModelDownloadSource, type ModelDownloadSource} from "../../../../contracts/model";
import {HEADLESS_CONTRACT_VERSION as version, type HeadlessHostIncarnationId} from "../../../../contracts/headless";
import {PreviewHeadlessModelSourceUseCase} from "../headless-model-source-preview.use-case";
import {PrepareHeadlessModelDownloadPlanUseCase} from "../headless-model-download-preview.use-case";

const organizationId = createOrganizationId("org.model-plan"), workspaceId = createWorkspaceId("workspace.model-plan");
const host = "ca353bdd-7793-44c6-8c36-c470be8c537c" as HeadlessHostIncarnationId;
function fixture(license: ModelDownloadSource["license"] = {kind: "unknown"}) {
  const source = readModelDownloadSource({provider: "huggingface", modelId: "fixture/model", revision: "a".repeat(40),
    format: "transformers-safetensors", license, files: ["config.json", "model.safetensors", "tokenizer.json"].map(path => ({
      path, sizeBytes: 10, integrity: {algorithm: path.endsWith("safetensors") ? "sha256" : "git-blob-sha1",
        digest: "b".repeat(path.endsWith("safetensors") ? 64 : 40)}})), totalBytes: 30, excludedFileCount: 0,
    sourceVerification: "provider-metadata", bytesVerification: "not-checked", runtimeReadiness: "not-checked"},
    {provider: "huggingface", modelId: "fixture/model", revision: "a".repeat(40)});
  const digest = "sha256:" + createHash("sha256").update(JSON.stringify(source)).digest("hex");
  const request = {version, operation: "models.download", input: {hostIncarnationId: host, workspaceId, idempotencyKey: randomUUID(),
    name: "Small model", sourceManifest: {source, manifestDigest: digest},
    allowedOrigins: ["https://huggingface.co"], maximumDurationSeconds: 1800, inferenceMode: "chat"}};
  const state = {current: true, allowed: true, calls: 0};
  let provider: ((...args: unknown[]) => Promise<unknown>) | undefined;
  const authority = {hostIncarnationId: host, context: {organizationId, principalId: "principal.synthetic", workspaceId},
    clientId: randomUUID(), modelSourceRead: true as const, isCurrent: () => state.current, stillAllowed: async () => state.allowed};
  const preview = new PreviewHeadlessModelSourceUseCase({organizationId, provider: {async inspectModelDownloadSource(target, control) {
    state.calls++; assert.deepEqual(target, {provider: "huggingface", modelId: source.modelId, revision: source.revision});
    assert.equal(control?.maximumDurationMs, 4000); assert.equal(control?.isCurrent(), true);
    return provider ? provider(target, control) as Promise<ModelDownloadSource> : JSON.parse(JSON.stringify(source)) as ModelDownloadSource;
  }}});
  const owner = new PrepareHeadlessModelDownloadPlanUseCase({organizationId, sourcePreview: preview});
  return {source, digest, request, state, authority, preview, owner, provider(value: typeof provider) {provider = value;}};
}

test("real source preview is revalidated before immutable plan preparation without transfer or readiness authority", async () => {
  const f = fixture(), result = await f.owner.execute(f.request, f.authority); assert.ok(result.ok);
  assert.equal(f.state.calls, 1); assert.equal(result.prepared.sourceManifest.manifestDigest, f.digest);
  assert.ok(Object.isFrozen(result.prepared.request.input.sourceManifest.source.files[0]));
  assert.ok(Object.isFrozen(result.prepared.request.input.allowedOrigins));
  assert.equal(result.prepared.downloadApprovalRequired, true); assert.equal(result.prepared.runtimeReadiness, "not-checked");
  assert.equal(result.prepared.bytesVerification, "not-checked"); assert.equal(result.prepared.temporaryStorageEstimateBytes, 60);
  assert.equal(result.prepared.fileTransferAccess, "public-without-credentials");
  assert.doesNotMatch(JSON.stringify(result), /localPath|private-payload|apiKey|authorization|acquisitionId|downloadToken|isCurrent|stillAllowed/);
});

test("foreign, missing and denied actor/source-read policy cannot call the provider", async () => {
  for (const change of [
    {context: {organizationId: createOrganizationId("org.other"), principalId: "principal.synthetic", workspaceId}},
    {context: {organizationId, principalId: "", workspaceId}},
    {context: {organizationId, principalId: "principal.synthetic", workspaceId: createWorkspaceId("workspace.other")}},
    {clientId: "unknown"}, {modelSourceRead: false}, {hostIncarnationId: randomUUID()}, {isCurrent: () => false}, {stillAllowed: async () => false},
  ]) {
    const f = fixture(); const result = await f.owner.execute(f.request, {...f.authority, ...change} as never);
    assert.equal(result.ok, false); assert.equal(f.state.calls, 0);
  }
});

test("active raw proposal and authority values are refused without running hooks", async () => {
  for (const variant of ["input-proxy", "nested-proxy", "input-getter", "authority-proxy", "authority-getter", "context-proxy"]) {
    const f = fixture(); let hooks = 0; let request: unknown = f.request, authority: unknown = f.authority;
    const active = () => new Proxy({}, {getPrototypeOf() {hooks++; throw new Error("No active reflection.");}});
    if (variant === "input-proxy") request = active();
    if (variant === "nested-proxy") request = {...f.request, input: {...f.request.input, sourceManifest: active()}};
    if (variant === "input-getter") {
      const input = {...f.request.input}; Object.defineProperty(input, "sourceManifest", {enumerable: true, get() {hooks++; return f.request.input.sourceManifest;}});
      request = {...f.request, input};
    }
    if (variant === "authority-proxy") authority = active();
    if (variant === "authority-getter") {
      authority = {...f.authority}; Object.defineProperty(authority, "context", {enumerable: true, get() {hooks++; return f.authority.context;}});
    }
    if (variant === "context-proxy") authority = {...f.authority, context: active()};
    assert.equal((await f.owner.execute(request, authority as never)).ok, false); assert.equal(hooks, 0); assert.equal(f.state.calls, 0);
  }
});

test("copied proposal and original callback identity survive caller mutation during a held metadata read", async () => {
  const f = fixture(); let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => {entered = resolve;}), held = new Promise<void>(resolve => {release = resolve;});
  f.provider(async () => {entered(); await held; return JSON.parse(JSON.stringify(f.source));});
  const pending = f.owner.execute(f.request, f.authority); await started;
  f.request.input.name = "Changed name"; f.request.input.maximumDurationSeconds = 1;
  f.request.input.allowedOrigins.push("https://different.example.org");
  f.authority.isCurrent = () => {throw new Error("Replaced function.");};
  f.authority.stillAllowed = async () => {throw new Error("Replaced function.");};
  release(); const result = await pending; assert.ok(result.ok);
  assert.equal(result.prepared.request.input.name, "Small model"); assert.equal(result.prepared.request.input.maximumDurationSeconds, 1800);
  assert.deepEqual(result.prepared.request.input.allowedOrigins, ["https://huggingface.co"]); assert.equal(f.state.calls, 1);
});

test("actor mutation, business withdrawal or host retirement during the metadata read yields no preparation", async () => {
  for (const variant of ["actor", "business", "host"]) {
    const f = fixture(); let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => {entered = resolve;}), held = new Promise<void>(resolve => {release = resolve;});
    f.provider(async () => {entered(); await held; return f.source;});
    const pending = f.owner.execute(f.request, f.authority); await started;
    if (variant === "actor") f.authority.context.principalId = "principal.other";
    if (variant === "business") f.state.allowed = false;
    if (variant === "host") f.state.current = false;
    release(); const result = await pending; assert.equal(result.ok, false); assert.equal("prepared" in result, false);
  }
});

test("substituted or changed provider metadata and claimed digest cannot become a prepared exact selection", async () => {
  for (const variant of ["request-digest", "provider-license", "provider-model", "provider-pin", "provider-private"]) {
    const f = fixture();
    if (variant === "request-digest") f.request.input.sourceManifest.manifestDigest = "sha256:" + "f".repeat(64);
    else f.provider(async () => variant === "provider-license" ? {...f.source, license: {kind: "provider-declared", identifier: "proprietary"}} :
      variant === "provider-model" ? {...f.source, modelId: "fixture/other"} : variant === "provider-pin" ? {...f.source, revision: "c".repeat(40)} :
        {...f.source, localPath: "synthetic-private-payload"});
    const result = await f.owner.execute(f.request, f.authority);
    assert.equal(result.ok, false); assert.equal("prepared" in result, false); assert.doesNotMatch(JSON.stringify(result), /synthetic-private/);
  }
});

test("the compiler independently refuses a forged source-preview hash, active result or late helper retirement", async () => {
  for (const variant of ["digest", "proxy", "getter", "retirement"]) {
    const f = fixture(); let hooks = 0;
    const owner = new PrepareHeadlessModelDownloadPlanUseCase({organizationId, sourcePreview: {async execute() {
      const response: any = {ok: true, operation: "models.preview-source", value: {workspaceId, source: f.source,
        manifestDigest: variant === "digest" ? "sha256:" + "f".repeat(64) : f.digest, downloadApprovalRequired: true}};
      if (variant === "proxy") return new Proxy(response, {getPrototypeOf() {hooks++; throw new Error("No proxy.");}});
      if (variant === "getter") Object.defineProperty(response.value, "source", {get() {hooks++; return f.source;}, enumerable: true});
      if (variant === "retirement") queueMicrotask(() => {f.state.current = false;});
      return response;
    }}});
    assert.equal((await owner.execute(f.request, f.authority)).ok, false); assert.equal(hooks, 0);
  }
});

test("non-open and unknown licenses are preserved without becoming license rights or transfer permission", async () => {
  for (const license of [{kind: "unknown"} as const, {kind: "provider-declared", identifier: "proprietary"} as const]) {
    const f = fixture(license), result = await f.owner.execute(f.request, f.authority); assert.ok(result.ok);
    assert.deepEqual(result.prepared.sourceManifest.source.license, license); assert.equal(result.prepared.downloadApprovalRequired, true);
    assert.doesNotMatch(JSON.stringify(result), /rightsGranted|transferApproved/);
  }
});

test("asynchronous liveness and nested-microtask retirement cannot enter a late provider read", async () => {
  const f = fixture(); let thenHooks = 0;
  for (const isCurrent of [() => Promise.reject(new Error("Synthetic retirement.")),
    () => ({get then() {thenHooks++; return undefined;}})]) {
    assert.equal((await f.owner.execute(f.request, {...f.authority, isCurrent} as never)).ok, false);
  }
  const result = await f.owner.execute(f.request, {...f.authority, stillAllowed: async () => {
    queueMicrotask(() => {f.state.current = false;}); return true;}});
  assert.equal(result.ok, false); assert.equal(f.state.calls, 0); assert.equal(thenHooks, 0);
});
