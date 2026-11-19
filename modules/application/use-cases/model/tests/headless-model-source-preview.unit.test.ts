import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {HEADLESS_CONTRACT_VERSION as version, type HeadlessHostIncarnationId} from "../../../../contracts/headless";
import {PreviewHeadlessModelSourceUseCase} from "../headless-model-source-preview.use-case";
import type {ModelDownloadSourcePort} from "../../../ports/model";

const organizationId = createOrganizationId("source-preview-org"), workspaceId = createWorkspaceId("source-preview-workspace");
const hostIncarnationId = "71598d9a-e219-4195-b51f-9f4ea9d3e39b" as HeadlessHostIncarnationId;
const clientId = "d3c6bed3-48bf-4f15-bc97-6b365f39498b", modelId = "Qwen/synthetic-model", revision = "a".repeat(40);
const request = {version, operation: "models.preview-source", input: {hostIncarnationId, workspaceId, modelId, revision}};
const source = () => ({provider: "huggingface" as const, modelId, revision, format: "transformers-safetensors" as const,
  license: {kind: "unknown" as const}, files: ["config.json", "model.safetensors", "tokenizer.json"].map(path => ({path, sizeBytes: 10,
    integrity: {algorithm: path.endsWith("safetensors") ? "sha256" as const : "git-blob-sha1" as const,
      digest: "b".repeat(path.endsWith("safetensors") ? 64 : 40)}})), totalBytes: 30, excludedFileCount: 0,
  sourceVerification: "provider-metadata" as const, bytesVerification: "not-checked" as const, runtimeReadiness: "not-checked" as const});
function fixture(provider?: ModelDownloadSourcePort) {
  const state = {current: true, permitted: true, calls: 0};
  const authority = {hostIncarnationId, context: {organizationId, principalId: "principal.synthetic", workspaceId}, clientId,
    modelSourceRead: true as const,
    isCurrent: () => state.current, stillAllowed: async () => state.permitted};
  const owner = new PreviewHeadlessModelSourceUseCase({organizationId, provider: provider ?? {
    async inspectModelDownloadSource(target, control) {
      state.calls++; assert.deepEqual(target, {provider: "huggingface", modelId, revision});
      assert.ok(Object.isFrozen(target)); assert.ok(Object.isFrozen(control));
      assert.equal(control?.maximumDurationMs, 4_000);
      assert.equal(control?.isCurrent(), true); assert.equal(await control?.stillAllowed(), true);
      return source();
    }}});
  return {state, authority, owner};
}

test("the explicit source owner passes current controls and hashes only normalized metadata", async () => {
  const {owner, authority, state} = fixture();
  const result = await owner.execute(request, authority);
  assert.ok(result.ok); assert.equal(state.calls, 1);
  assert.equal(result.value.manifestDigest, "sha256:" + createHash("sha256").update(JSON.stringify(result.value.source)).digest("hex"));
  assert.equal(result.value.downloadApprovalRequired, true); assert.equal(result.value.source.runtimeReadiness, "not-checked");
});

test("wrong tenant/workspace/client/principal and denied policy cannot reach the provider", async () => {
  for (const change of [
    {context: {organizationId: createOrganizationId("other-org"), principalId: "principal.synthetic", workspaceId}},
    {context: {organizationId, principalId: "principal.synthetic", workspaceId: createWorkspaceId("other-workspace")}},
    {clientId: "not-a-client"}, {context: {organizationId, principalId: "", workspaceId}},
    {modelSourceRead: undefined}, {modelSourceRead: false},
    {stillAllowed: async () => false}, {isCurrent: () => false}, {isCurrent: () => Promise.reject(new Error("synthetic rejected fence"))},
  ]) {
    const {owner, authority, state} = fixture();
    assert.deepEqual(await owner.execute(request, {...authority, ...change} as never), {ok: false, code: "headless.forbidden"});
    assert.equal(state.calls, 0);
  }
  await new Promise(resolve => setImmediate(resolve));
});

test("caller target mutation during a held policy cannot change the dispatched source", async () => {
  const {owner, authority, state} = fixture();
  let release!: () => void, first = true;
  const held = new Promise<void>(resolve => {release = resolve;});
  authority.stillAllowed = async () => {if (first) {first = false; await held;} return true;};
  const mutable = {...request, input: {...request.input}};
  const pending = owner.execute(mutable, authority);
  mutable.input.modelId = "Qwen/changed"; mutable.input.revision = "b".repeat(40);
  release();
  const result = await pending;
  assert.ok(result.ok); assert.equal(result.value.source.modelId, modelId); assert.equal(result.value.source.revision, revision);
  assert.equal(state.calls, 1);
});

test("nested-microtask retirement after a policy helper prevents provider invocation and egress", async () => {
  for (const phase of ["dispatch", "egress"]) {
    let providerCalls = 0;
    const {owner, authority, state} = fixture({inspectModelDownloadSource: async () => {providerCalls++; return source();}});
    let policies = 0;
    authority.stillAllowed = async () => {
      if (++policies === (phase === "dispatch" ? 1 : 3))
        queueMicrotask(() => queueMicrotask(() => {state.current = false;}));
      return true;
    };
    assert.deepEqual(await owner.execute(request, authority), {ok: false, code: "headless.forbidden"});
    assert.equal(providerCalls, phase === "dispatch" ? 0 : 1);
  }
});

test("Node ingress refuses nested proxies or accessors before evaluating their values", async () => {
  const {owner, authority, state} = fixture();
  const proxy = new Proxy(request.input, {ownKeys() {assert.fail("Do not reflect a nested Proxy");}});
  assert.deepEqual(await owner.execute({...request, input: proxy}, authority), {ok: false, code: "headless.invalid-request"});
  const input = Object.defineProperty({...request.input}, "modelId", {enumerable: true, get() {assert.fail("Do not read an accessor");}});
  assert.equal((await owner.execute({...request, input}, authority)).ok, false);
  assert.equal(state.calls, 0);
});

test("awaited source work cannot change its copied target or publish after actor/client retirement", async () => {
  for (const retire of ["actor", "client", "context", "host", "policy", "current"] as const) {
    let release!: (value: ReturnType<typeof source>) => void;
    const held = new Promise<ReturnType<typeof source>>(resolve => {release = resolve;});
    const {owner, authority, state} = fixture({inspectModelDownloadSource: async () => held});
    const pending = owner.execute(request, authority);
    await new Promise(resolve => setImmediate(resolve));
    if (retire === "actor") authority.context.principalId = "other.principal";
    else if (retire === "client") authority.clientId = "6b6f4e59-bb13-4e0c-b30c-f164b723d058";
    else if (retire === "context") authority.context = {...authority.context};
    else if (retire === "host") authority.hostIncarnationId = "39c8ea67-9724-4e9d-ad4d-570bf2fad290" as HeadlessHostIncarnationId;
    else if (retire === "policy") state.permitted = false;
    else state.current = false;
    release(source());
    assert.deepEqual(await pending, {ok: false, code: "headless.forbidden"});
  }
});

test("malformed/substituted provider results and exceptions expose only fixed failures", async () => {
  for (const raw of [{...source(), modelId: "Qwen/other"}, {...source(), revision: "b".repeat(40)},
    {...source(), rawProviderBody: "private body"}, {...source(), totalBytes: 31}]) {
    const {owner, authority} = fixture({inspectModelDownloadSource: async () => raw as never});
    assert.deepEqual(await owner.execute(request, authority), {ok: false, code: "headless.unavailable"});
  }
  const {owner, authority} = fixture({inspectModelDownloadSource: async () => {throw new Error("private credential or provider body");}});
  assert.deepEqual(await owner.execute(request, authority), {ok: false, code: "headless.unavailable"});
});
