import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {createInMemoryStructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {createHuggingFaceModelBrowseDetailsAdapter} from "../../../../adapters/model/huggingface";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {readModelDownloadSource} from "../../../../contracts/model";
import {HEADLESS_CONTRACT_VERSION as version, HEADLESS_READ_OPERATIONS, type HeadlessHostIncarnationId,
  type HeadlessReadRequest} from "../../../../contracts/headless";
import {composeDesktopHeadlessReads} from "../../../desktop/composition/composeDesktopHeadlessReads";
import {composeManagedAgentReads} from "../../../server/composition/composeManagedAgentReads";
import {composeHeadlessModelSourcePreview} from "../headlessModelSourcePreview";

const organizationId = createOrganizationId("source-host-org"), workspaceId = createWorkspaceId("source-host-workspace");
const hostIncarnationId = "d6ea7ed7-4797-4d3c-883f-84d87aa392b9" as HeadlessHostIncarnationId;
const registeredClientId = "66271863-466f-42e0-a5f3-0084178c59a9", modelId = "Qwen/synthetic-model", revision = "a".repeat(40);
const query = () => ({version, operation: "models.preview-source", input: {hostIncarnationId, workspaceId, modelId, revision}} as const);
const denied = {ok: false, code: "headless.forbidden"}, unavailable = {ok: false, code: "headless.unavailable"};
const providerInfo = {id: modelId, _id: "provider-opaque", sha: revision, cardData: {license: "apache-2.0", content: "Private model card"}};
const providerFiles = ["config.json", "model.safetensors", "tokenizer.json"].map(path => ({type: "file", path, size: 10,
  oid: "b".repeat(40), ...(path.endsWith("safetensors") ? {lfs: {oid: "c".repeat(64), size: 10}} : {})}));

function fixture(host: "desktop" | "managed") {
  const state = {current: true, readCurrent: true, planning: true, permitted: true, opens: 0, tokens: 0, executions: 0,
    reply: undefined as unknown, onAuthorize: () => {}, onOpen: () => {}, onToken: () => {}, fence: () => true as unknown};
  const identity = {organizationId, principalId: "principal.synthetic", purpose: "plan-review" as "plan-review" | "agent", registeredClientId,
    modelSourceRead: true as true | undefined};
  const requiredScopes: string[][] = [];
  const documents = createInMemoryStructuredDocumentStore().forOrganization(organizationId);
  const owner = composeHeadlessModelSourcePreview(documents, createHuggingFaceModelBrowseDetailsAdapter({
    accessTokenProvider: () => {state.tokens++; state.onToken(); return undefined;}}));
  const getModelSource = async () => {state.opens++; state.onOpen(); return {async execute(...args: Parameters<typeof owner.execute>) {
    state.executions++;
    return state.reply === undefined ? owner.execute(...args) : state.reply as never;
  }};};
  const workspaces = {async readWorkspace() {return {workspaceId, organizationId, displayName: "Synthetic workspace", status: "active",
    createdAt: "2026-11-19T00:00:00.000Z", updatedAt: "2026-11-19T00:00:00.000Z"} as const;}};
  const authorization = {async authorizeWorkspaceOperation(request: {requiredScopes: readonly string[]}) {
    requiredScopes.push([...request.requiredScopes]); state.onAuthorize();
    if (!state.permitted) throw new Error("Synthetic policy denied");
  }};
  const noFeature = () => {assert.fail("Source preview must not warm system, runtime, task or file discovery owners.");};
  const read = host === "desktop" ? (() => {
    const handler = composeDesktopHeadlessReads({hostIncarnationId, identity, workspaceRepository: workspaces, authorization,
      getUseCases: noFeature, getModelSource, isOpen: () => state.current});
    return (request: HeadlessReadRequest = query()) => handler(request, async () => ({...identity, workspaceIds: [workspaceId],
      operations: HEADLESS_READ_OPERATIONS, ...(state.planning ? {planReview: true as const} : {}),
      isCurrent: state.fence as () => boolean, isReadCurrent: () => state.readCurrent}));
  })() : (() => {
    const handler = composeManagedAgentReads({hostIncarnationId, contexts: {getCurrentOrganizationContext: () => identity},
      workspaces, authorization, systems: {listTemplates: {execute: noFeature}, read: {execute: noFeature}}, getModelSource});
    return (request: HeadlessReadRequest = query()) => {
      identity.purpose = state.planning ? "plan-review" : "agent";
      return handler(request, identity, () => state.current && state.fence() as boolean);
    };
  })();
  return {state, identity, read, requiredScopes};
}

async function withProvider<T>(run: () => Promise<T>) {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input) => {
    calls++;
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.origin, "https://huggingface.co");
    assert.equal(url.pathname.includes(modelId), true);
    assert.equal(url.pathname.endsWith(revision), true);
    return Response.json(url.pathname.includes("/tree/") ? providerFiles : providerInfo);
  }) as typeof fetch;
  try {return {value: await run(), calls};} finally {globalThis.fetch = original;}
}

for (const host of ["desktop", "managed"] as const) {
  test(`${host} source read composes actual application and installed SDK under model/credential policy`, async () => {
    const {read, state, requiredScopes} = fixture(host);
    const {value: result, calls} = await withProvider(() => read());
    assert.ok(result.ok && result.operation === "models.preview-source");
    assert.equal(calls, 2); assert.equal(state.tokens, 1); assert.equal(state.opens, 1);
    assert.ok(requiredScopes.length > 0);
    assert.ok(requiredScopes.every(scopes => ["workspace:read", "model:read", "provider-credential:use"].every(scope => scopes.includes(scope))));
    assert.equal(result.value.manifestDigest, "sha256:" + createHash("sha256").update(JSON.stringify(result.value.source)).digest("hex"));
    assert.equal(result.value.source.bytesVerification, "not-checked");
    assert.doesNotMatch(JSON.stringify(result), /Private model card|provider-opaque|localPath|rawProvider/);
  });

  test(`${host} discovery stays passive and source access requires planning/current policy`, async () => {
    const {read, state} = fixture(host);
    const {calls} = await withProvider(async () => {
      const described = await read({version, operation: "host.describe", input: {}});
      assert.ok(described.ok && described.operation === "host.describe");
      assert.ok(described.value.operations.includes("models.preview-source"));
      assert.equal(state.opens, 0); assert.equal(state.tokens, 0);
      state.planning = false;
      assert.deepEqual(await read(), denied); assert.equal(state.opens, 0);
      state.planning = true; state.permitted = false;
      assert.deepEqual(await read(), denied); assert.equal(state.opens, 0);
    });
    assert.equal(calls, 0);
  });

  test(`${host} an older plan-review grant cannot inherit credential-bearing source access`, async () => {
    const {read, state, identity} = fixture(host);
    identity.modelSourceRead = undefined;
    const {calls} = await withProvider(async () => {
      const described = await read({version, operation: "host.describe", input: {}});
      assert.ok(described.ok && described.operation === "host.describe");
      assert.equal(described.value.operations.includes("models.preview-source"), false);
      assert.deepEqual(await read(), denied);
    });
    assert.equal(calls, 0); assert.equal(state.opens, 0); assert.equal(state.tokens, 0);
  });

  test(`${host} nested-microtask policy retirement cannot enter a late source owner`, async () => {
    const {read, state} = fixture(host);
    let policies = 0;
    state.onAuthorize = () => {
      if (++policies === 2)
        queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => {state.current = false;})));
    };
    const {value, calls} = await withProvider(() => read());
    assert.deepEqual(value, denied); assert.equal(calls, 0); assert.equal(state.tokens, 0); assert.equal(state.executions, 0);
    assert.equal(state.opens, host === "desktop" ? 0 : 1);
  });

  test(`${host} source read cannot start provider work after retirement at lazy or credential boundaries`, async () => {
    for (const stage of ["open", "token"] as const) {
      const {read, state} = fixture(host);
      if (stage === "open") state.onOpen = () => {state.current = false;};
      else state.onToken = () => {state.current = false;};
      const {value, calls} = await withProvider(() => read());
      assert.deepEqual(value, denied); assert.equal(calls, 0);
      assert.equal(state.tokens, stage === "token" ? 1 : 0);
    }
  });

  test(`${host} caller mutations during policy awaits cannot retarget the source read`, async () => {
    const {read, state} = fixture(host);
    const raw = {version, operation: "models.preview-source", input: {hostIncarnationId, workspaceId, modelId, revision}} as const;
    state.onAuthorize = () => {Object.assign(raw.input, {modelId: "Qwen/changed", revision: "b".repeat(40)});};
    const {value, calls} = await withProvider(() => read(raw));
    assert.ok(value.ok && value.operation === "models.preview-source");
    assert.equal(calls, 2); assert.equal(value.value.source.modelId, modelId); assert.equal(value.value.source.revision, revision);
  });

  test(`${host} source egress rejects altered digests, targets, private data and false readiness`, async () => {
    const source = readModelDownloadSource({provider: "huggingface", modelId, revision, format: "transformers-safetensors", license: {kind: "unknown"},
      files: providerFiles.map(file => ({path: file.path, sizeBytes: file.size, integrity: file.lfs
        ? {algorithm: "sha256", digest: file.lfs.oid} : {algorithm: "git-blob-sha1", digest: file.oid}})),
      totalBytes: 30, excludedFileCount: 0, sourceVerification: "provider-metadata", bytesVerification: "not-checked", runtimeReadiness: "not-checked"},
    {provider: "huggingface", modelId, revision});
    const value = {workspaceId, source, manifestDigest: "sha256:" + createHash("sha256").update(JSON.stringify(source)).digest("hex"), downloadApprovalRequired: true};
    for (const changed of [
      {ok: true, operation: "models.record", value},
      {ok: true, operation: "models.preview-source", value: {...value, manifestDigest: "sha256:" + "f".repeat(64)}},
      {ok: true, operation: "models.preview-source", value: {...value, privateBody: "private card"}},
      {ok: true, operation: "models.preview-source", value: {...value, source: {...source, modelId: "Qwen/other"}}},
      {ok: true, operation: "models.preview-source", value: {...value, source: {...source, runtimeReadiness: "ready"}}},
      {ok: true, operation: "models.preview-source", value: {...value, downloadApprovalRequired: false}},
    ]) {
      const {read, state} = fixture(host); state.reply = changed;
      assert.deepEqual(await read(), unavailable); assert.equal(state.tokens, 0);
    }
  });
}
