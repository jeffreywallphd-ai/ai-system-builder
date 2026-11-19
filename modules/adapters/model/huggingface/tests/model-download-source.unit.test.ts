import assert from "node:assert/strict";
import test from "node:test";
import {createHuggingFaceModelBrowseDetailsAdapter} from "../createHuggingFaceModelBrowseDetailsAdapter";

const revision = "a".repeat(40), otherRevision = "b".repeat(40), modelId = "Qwen/synthetic-model";
const request = {provider: "huggingface", modelId, revision} as const;
const safeError = {message: "Model source inspection is unavailable."};
const metadata = () => ({id: modelId, _id: "opaque-provider-id", sha: revision, cardData: {license: "apache-2.0", content: "Private card body"}});
const row = (path: string, size = 10) => ({type: "file", path, size, oid: "c".repeat(40),
  ...(path.endsWith(".safetensors") ? {lfs: {oid: "d".repeat(64), size, pointerSize: 120}} : {})});
const tree = () => [row("config.json"), row("tokenizer.json"), row("model.safetensors"), row("model.py"), row("pytorch_model.bin")];
const urlOf = (input: Parameters<typeof fetch>[0]) => new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
async function withFetch(run: (calls: {url: URL; init?: RequestInit}[]) => Promise<void>, reply?: (url: URL) => Response) {
  const previous = globalThis.fetch, calls: {url: URL; init?: RequestInit}[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = urlOf(input); calls.push({url, init});
    return reply?.(url) ?? Response.json(url.pathname.includes("/tree/") ? tree() : metadata());
  }) as typeof fetch;
  try {await run(calls);} finally {globalThis.fetch = previous;}
}

test("real installed SDK resolves exact source and lists only that revision, with bounded safe projection", async () => {
  await withFetch(async calls => {
    let tokenReads = 0;
    const owner = createHuggingFaceModelBrowseDetailsAdapter({accessTokenProvider: () => {tokenReads++; return "hf_source_fixture_not_a_real_key";}});
    assert.equal(calls.length, 0); assert.equal(tokenReads, 0);
    const result = await owner.inspectModelDownloadSource(request);
    assert.equal(tokenReads, 1); assert.equal(calls.length, 2);
    assert.equal(calls[0].url.pathname, `/api/models/${modelId}/revision/${revision}`);
    assert.equal(calls[1].url.pathname, `/api/models/${modelId}/tree/${revision}`);
    assert.equal(calls[1].url.searchParams.get("recursive"), "true");
    assert.ok(calls.every(call => call.init?.redirect === "error" && call.init.signal?.aborted));
    assert.ok(calls.every(call => (call.init?.headers as Record<string, string>).Authorization === "Bearer hf_source_fixture_not_a_real_key"));
    assert.deepEqual(result.files.map(file => file.path), ["config.json", "model.safetensors", "tokenizer.json"]);
    assert.equal(result.excludedFileCount, 2); assert.equal(result.totalBytes, 30);
    assert.deepEqual(result.files[1].integrity, {algorithm: "sha256", digest: "d".repeat(64)});
    assert.deepEqual(result.files[0].integrity, {algorithm: "git-blob-sha1", digest: "c".repeat(40)});
    assert.deepEqual(result.license, {kind: "provider-declared", identifier: "apache-2.0"});
    assert.equal(result.bytesVerification, "not-checked");
    assert.doesNotMatch(JSON.stringify(result), /Private card body|hf_source_fixture_not_a_real_key|model.py|pytorch_model.bin|opaque-provider-id/);
  });
});

test("HEAD resolution immediately binds file listing to its returned immutable revision", async () => {
  await withFetch(async calls => {
    const source = await createHuggingFaceModelBrowseDetailsAdapter().inspectModelDownloadSource({provider: "huggingface", modelId});
    assert.equal(calls[0].url.pathname, `/api/models/${modelId}/revision/HEAD`);
    assert.equal(calls[1].url.pathname, `/api/models/${modelId}/tree/${revision}`);
    assert.equal(source.revision, revision);
  });
});

test("captured repository/revision survive a held credential await", async () => {
  let release!: (value: string | undefined) => void;
  const held = new Promise<string | undefined>(resolve => {release = resolve;});
  await withFetch(async calls => {
    const mutable = {...request, modelId: request.modelId as string};
    const owner = createHuggingFaceModelBrowseDetailsAdapter({accessTokenProvider: () => held});
    const pending = owner.inspectModelDownloadSource(mutable);
    mutable.modelId = "Qwen/changed"; mutable.revision = otherRevision;
    release(undefined);
    const source = await pending;
    assert.equal(source.modelId, modelId); assert.equal(source.revision, revision);
    assert.ok(calls.every(call => call.url.pathname.includes(modelId) && !call.url.pathname.includes("changed")));
  });
});

test("one source inspection owns its slot before dependency or credential I/O", async () => {
  let release!: (value: undefined) => void, tokenReads = 0;
  const held = new Promise<undefined>(resolve => {release = resolve;});
  await withFetch(async calls => {
    const owner = createHuggingFaceModelBrowseDetailsAdapter({accessTokenProvider: () => {tokenReads++; return held;}});
    const first = owner.inspectModelDownloadSource(request);
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(owner.inspectModelDownloadSource(request), safeError);
    assert.equal(tokenReads, 1); assert.equal(calls.length, 0);
    release(undefined); await first;
    await owner.inspectModelDownloadSource(request);
    assert.equal(tokenReads, 2); assert.equal(calls.length, 4);
  });
});

test("malformed requests fail before client or credentials resolve", async () => {
  let imports = 0, tokens = 0;
  const owner = createHuggingFaceModelBrowseDetailsAdapter({officialHubClientLoader: async () => {imports++; throw new Error("not called");},
    accessTokenProvider: () => {tokens++; return undefined;}});
  for (const revision of ["main", "A".repeat(40), null])
    await assert.rejects(owner.inspectModelDownloadSource({...request, revision} as never), safeError);
  await assert.rejects(owner.inspectModelDownloadSource(new Proxy(request, {ownKeys() {assert.fail("Do not reflect a Proxy");}})), safeError);
  assert.equal(imports, 0); assert.equal(tokens, 0);
});

test("SDK missing file inspection refuses without breaking ordinary details", async () => {
  const hubClient = {listModels: async function* () {}, modelInfo: async () => ({name: modelId, sha: revision})};
  const owner = createHuggingFaceModelBrowseDetailsAdapter({hubClient});
  await assert.rejects(owner.inspectModelDownloadSource(request), safeError);
  assert.equal((await owner.getModelDetails({provider: "huggingface", modelId})).model.modelId, modelId);
});

test("failed lazy imports and credential suppliers cannot disclose private failure text", async () => {
  const logs: unknown[] = [];
  const owner = createHuggingFaceModelBrowseDetailsAdapter({logger: {info: (...data) => {logs.push(data);}, warn: (...data) => {logs.push(data);}},
    officialHubClientLoader: async () => {throw new Error("Private import path and credential details");}});
  await assert.rejects(owner.inspectModelDownloadSource(request), safeError);
  assert.doesNotMatch(JSON.stringify(logs), /Private import path|credential details/);
  const other = createHuggingFaceModelBrowseDetailsAdapter({hubClient: {listModels: async function* () {},
    modelInfo: async () => ({name: modelId, sha: revision}), listFiles: async function* () {}},
    accessTokenProvider: () => {throw new Error("Private saved credential details");}});
  await assert.rejects(other.inspectModelDownloadSource(request), safeError);
});

test("substituted identity or revision, invalid listings and unverified hashes refuse with fixed diagnostics", async () => {
  for (const mutation of [
    {info: {...metadata(), id: "Qwen/other"}}, {info: {...metadata(), sha: otherRevision}},
    {info: {...metadata(), sha: "main"}},
    {files: [...tree(), row("../outside.json")]}, {files: [...tree(), row("MODEL.safetensors")]},
    {files: tree().filter(file => file.path !== "tokenizer.json")},
    {files: tree().map(file => file.path === "model.safetensors" ? {...file, lfs: undefined} : file)},
    {files: tree().map(file => file.path === "model.safetensors" ? {...file, lfs: {oid: "e".repeat(40), size: 10}} : file)},
    {files: tree().map(file => file.path === "model.safetensors" ? {...file, lfs: {oid: "e".repeat(64), size: 9}} : file)},
    {files: [...tree(), {type: "unknown", path: "extra", size: 0}]},
    {files: [...tree(), ...Array.from({length: 65}, (_, i) => row(`shard-${i}.safetensors`))]},
    {files: [...tree(), ...Array.from({length: 256}, (_, i) => row(`excluded-${i}.bin`))]},
  ]) await withFetch(async () => {
    await assert.rejects(createHuggingFaceModelBrowseDetailsAdapter().inspectModelDownloadSource(request), safeError);
  }, url => Response.json(url.pathname.includes("/tree/") ? mutation.files ?? tree() : mutation.info ?? metadata()));
});

test("non-open declarations stay recorded and missing/malformed license data stays unknown", async () => {
  for (const [license, expected] of [["proprietary", {kind: "provider-declared", identifier: "proprietary"}],
    [undefined, {kind: "unknown"}], ["Private license text\n", {kind: "unknown"}], [["apache-2.0"], {kind: "unknown"}]] as const)
    await withFetch(async () => {
      const source = await createHuggingFaceModelBrowseDetailsAdapter().inspectModelDownloadSource(request);
      assert.deepEqual(source.license, expected);
    }, url => Response.json(url.pathname.includes("/tree/") ? tree() : {...metadata(), cardData: {license}}));
});

test("foreign/changed-target pagination is denied before another credential-bearing request", async () => {
  for (const link of ["https://foreign.invalid/api/models/other/tree/main?recursive=true&expand=false",
    `https://huggingface.co/api/models/${modelId}/tree/${otherRevision}?recursive=true&expand=false`,
    `https://huggingface.co/api/models/${modelId}/tree/${revision}?recursive=false&expand=false`])
    await withFetch(async calls => {
      await assert.rejects(createHuggingFaceModelBrowseDetailsAdapter().inspectModelDownloadSource(request), safeError);
      assert.equal(calls.length, 2);
    }, url => url.pathname.includes("/tree/") ? Response.json(tree(), {headers: {Link: `<${link}>; rel="next"`}}) : Response.json(metadata()));
});

test("valid pagination merges a finite manifest while loops stop at the fixed request limit", async () => {
  const next = `https://huggingface.co/api/models/${modelId}/tree/${revision}?recursive=true&expand=false&cursor=second`;
  await withFetch(async calls => {
    const source = await createHuggingFaceModelBrowseDetailsAdapter().inspectModelDownloadSource(request);
    assert.equal(calls.length, 3); assert.equal(source.files.length, 3);
  }, url => !url.pathname.includes("/tree/") ? Response.json(metadata()) : url.searchParams.has("cursor")
    ? Response.json(tree().slice(2)) : Response.json(tree().slice(0, 2), {headers: {Link: `<${next}>; rel="next"`}}));
  await withFetch(async calls => {
    await assert.rejects(createHuggingFaceModelBrowseDetailsAdapter().inspectModelDownloadSource(request), safeError);
    assert.equal(calls.length, 5);
  }, url => url.pathname.includes("/tree/") ? Response.json([], {headers: {Link: `<${next}>; rel="next"`}}) : Response.json(metadata()));
});

test("redirects, non-success and advertised or streamed oversized metadata refuse", async () => {
  for (const reply of [() => new Response(null, {status: 302, headers: {location: "https://foreign.invalid/"}}),
    () => new Response("private provider error", {status: 403}),
    () => new Response("{}", {headers: {"content-length": String(512 * 1024 + 1)}}),
    () => new Response(new Uint8Array(512 * 1024 + 1))])
    await withFetch(async calls => {
      await assert.rejects(createHuggingFaceModelBrowseDetailsAdapter().inspectModelDownloadSource(request), safeError);
      assert.equal(calls.length, 1);
    }, reply);
});

test("deadline also bounds lazy SDK/credential waits and prevents a late provider request", async context => {
  context.mock.timers.enable({apis: ["setTimeout"]});
  for (const phase of ["client", "credential"]) {
    let release!: () => void, tokenReads = 0, requests = 0;
    const held = new Promise<void>(resolve => {release = resolve;});
    const client = {modelInfo: async () => {requests++; return {name: modelId, sha: revision};},
      listFiles: async function* () {yield* tree();}, listModels: async function* () {}};
    const owner = createHuggingFaceModelBrowseDetailsAdapter({officialHubClientLoader: async () => {
      if (phase === "client") await held; return client;
    }, accessTokenProvider: async () => {tokenReads++; if (phase === "credential") await held; return undefined;}});
    const failure = assert.rejects(owner.inspectModelDownloadSource(request), safeError);
    await new Promise(resolve => setImmediate(resolve));
    context.mock.timers.tick(20_000);
    await failure;
    await assert.rejects(owner.inspectModelDownloadSource(request), safeError);
    release(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(tokenReads, phase === "client" ? 0 : 1); assert.equal(requests, 0);
    assert.equal((await owner.inspectModelDownloadSource(request)).revision, revision);
    assert.equal(requests, 1);
  }
});

test("total metadata budget applies across otherwise valid bounded pages", async () => {
  let pages = 0;
  const next = `https://huggingface.co/api/models/${modelId}/tree/${revision}?recursive=true&expand=false&cursor=next`;
  await withFetch(async calls => {
    await assert.rejects(createHuggingFaceModelBrowseDetailsAdapter().inspectModelDownloadSource(request), safeError);
    assert.equal(calls.length, 5);
  }, url => {
    if (!url.pathname.includes("/tree/")) return Response.json(metadata());
    const json = JSON.stringify(pages++ === 0 ? tree() : []);
    return new Response(" ".repeat(512 * 1024 - json.length) + json,
      {headers: pages < 4 ? {Link: `<${next}>; rel="next"`} : {}});
  });
});

test("delegated policy/currentness refuses before SDK or credential access", async () => {
  let imports = 0, tokenReads = 0;
  const owner = createHuggingFaceModelBrowseDetailsAdapter({officialHubClientLoader: async () => {imports++; throw new Error("not called");},
    accessTokenProvider: () => {tokenReads++; return undefined;}});
  for (const control of [
    {isCurrent: () => false, stillAllowed: async () => true},
    {isCurrent: () => true, stillAllowed: async () => false},
    {isCurrent: () => Promise.resolve(true), stillAllowed: async () => true},
    {isCurrent: () => Promise.reject(new Error("synthetic rejected fence")), stillAllowed: async () => true},
    {isCurrent: () => true, stillAllowed: async () => 1},
    {isCurrent: () => true, stillAllowed: async () => true, maximumDurationMs: 20_001},
  ]) await assert.rejects(owner.inspectModelDownloadSource(request, control as never), safeError);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(imports, 0); assert.equal(tokenReads, 0);
});

test("nested-microtask retirement cannot cross policy-to-SDK or policy-to-credential handoffs", async () => {
  for (const stage of ["sdk", "credential"]) {
    let current = true, policies = 0, imports = 0, tokens = 0;
    const client = {listModels: async function* () {}, modelInfo: async () => ({name: modelId, sha: revision}), listFiles: async function* () {}};
    const owner = createHuggingFaceModelBrowseDetailsAdapter({officialHubClientLoader: async () => {imports++; return client;},
      accessTokenProvider: () => {tokens++; return undefined;}});
    await assert.rejects(owner.inspectModelDownloadSource(request, {isCurrent: () => current, stillAllowed: async () => {
      if (++policies === (stage === "sdk" ? 1 : 2))
        queueMicrotask(() => queueMicrotask(() => {current = false;}));
      return true;
    }}), safeError);
    assert.equal(imports, stage === "sdk" ? 0 : 1); assert.equal(tokens, 0);
  }
});

test("revocation while credentials resolve cannot begin a provider request", async () => {
  let release!: (value: undefined) => void, current = true;
  const held = new Promise<undefined>(resolve => {release = resolve;});
  await withFetch(async calls => {
    const owner = createHuggingFaceModelBrowseDetailsAdapter({accessTokenProvider: () => held});
    const pending = owner.inspectModelDownloadSource(request, {isCurrent: () => current, stillAllowed: async () => current});
    await new Promise(resolve => setImmediate(resolve));
    current = false; release(undefined);
    await assert.rejects(pending, safeError);
    assert.equal(calls.length, 0);
  });
});

test("fresh delegated policy is required before following provider pagination", async () => {
  let permitted = true;
  const next = `https://huggingface.co/api/models/${modelId}/tree/${revision}?recursive=true&expand=false&cursor=next`;
  await withFetch(async calls => {
    await assert.rejects(createHuggingFaceModelBrowseDetailsAdapter().inspectModelDownloadSource(request,
      {isCurrent: () => true, stillAllowed: async () => permitted}), safeError);
    assert.equal(calls.length, 2);
  }, url => {
    if (!url.pathname.includes("/tree/")) return Response.json(metadata());
    permitted = false;
    return Response.json(tree(), {headers: {Link: `<${next}>; rel="next"`}});
  });
});

test("delegated callers can narrow the existing deadline without overlapping a late credential read", async context => {
  context.mock.timers.enable({apis: ["setTimeout"]});
  let release!: (value: undefined) => void;
  const held = new Promise<undefined>(resolve => {release = resolve;});
  await withFetch(async calls => {
    const owner = createHuggingFaceModelBrowseDetailsAdapter({accessTokenProvider: () => held});
    const control = {isCurrent: () => true, stillAllowed: async () => true, maximumDurationMs: 10_000};
    const failure = assert.rejects(owner.inspectModelDownloadSource(request, control), safeError);
    await new Promise(resolve => setImmediate(resolve));
    context.mock.timers.tick(9_999);
    assert.equal(calls.length, 0);
    context.mock.timers.tick(1); await failure;
    await assert.rejects(owner.inspectModelDownloadSource(request, control), safeError);
    release(undefined); await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 0);
    assert.equal((await owner.inspectModelDownloadSource(request, control)).revision, revision);
  });
});
