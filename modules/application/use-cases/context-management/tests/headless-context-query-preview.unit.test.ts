import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import test from "node:test";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {HEADLESS_CONTRACT_VERSION as version, type HeadlessContextQueryPreviewRequest} from "../../../../contracts/headless";
import {PreviewHeadlessContextQueryUseCase} from "../headless-context-query-preview.use-case";

function fixture() {
  const context = {organizationId: createOrganizationId("org.query-preview"), principalId: "principal.synthetic", workspaceId: createWorkspaceId("workspace.synthetic")};
  const reference = {workspaceId: context.workspaceId, contextId: randomUUID(), taskId: randomUUID(), kind: "rag-database" as const,
    artifactDigest: "sha256:" + "a".repeat(64)};
  const request: HeadlessContextQueryPreviewRequest = {version, operation: "context.preview-query", input: {
    hostIncarnationId: randomUUID() as never, workspaceId: context.workspaceId, reference, query: "Synthetic private question café 📄",
    maximumResults: 5, embeddingDevice: "cpu"}};
  const authority = {context, clientId: randomUUID(), isCurrent: () => true, stillAllowed: async () => true};
  const facts = {modelRecordId: "model.embedding", modelUpdatedAt: "2026-11-18T00:00:00.000Z", sourceCount: 1};
  return {request, authority, facts};
}

test("query preview hashes exact question synchronously and gives asynchronous metadata no raw question", async () => {
  const f = fixture(), original = structuredClone(f.request.input), actor = structuredClone(f.authority.context);
  let enter!: () => void, resume!: () => void, first = true, reads = 0;
  const entered = new Promise<void>(resolve => {enter = resolve;}), gate = new Promise<void>(resolve => {resume = resolve;});
  const app = new PreviewHeadlessContextQueryUseCase(async (target, context) => {
    reads++; assert.deepEqual(target, {hostIncarnationId: original.hostIncarnationId, workspaceId: original.workspaceId, reference: original.reference});
    assert.deepEqual(context, actor); assert.ok(Object.isFrozen(target)); assert.ok(Object.isFrozen(target.reference)); assert.ok(Object.isFrozen(context));
    assert.doesNotMatch(JSON.stringify(target), /Synthetic private|"query"/); return f.facts;
  });
  f.authority.stillAllowed = async () => {if (first) {first = false; enter(); await gate;} return true;};
  const running = app.execute(f.request, f.authority); await entered;
  Object.assign(f.request.input, {query: "replaced question", maximumResults: 20});
  Object.assign(f.request.input.reference, {contextId: randomUUID()}); f.authority.context.principalId = "changed"; resume();
  const result = await running; assert.ok(result.ok); assert.equal(reads, 1);
  assert.equal(result.value.queryDigest, "sha256:" + createHash("sha256").update(original.query, "utf8").digest("hex"));
  assert.deepEqual(result.value.reference, original.reference); assert.equal(result.value.maximumResults, 5);
  assert.equal(result.value.runtimeReadiness, "not-checked"); assert.equal(result.value.byteAvailability, "not-checked");
  assert.doesNotMatch(JSON.stringify(result), /Synthetic private|replaced question|"query":/);
});

test("invalid scope, text, callbacks and proxy/accessor data cannot reach metadata", async () => {
  let reads = 0, getters = 0;
  const app = new PreviewHeadlessContextQueryUseCase(async () => {reads++; return fixture().facts;});
  for (const patch of [{query: "x".repeat(2001)}, {query: "\ud800"}, {maximumResults: 21}, {embeddingDevice: "auto"}]) {
    const f = fixture(); assert.equal((await app.execute({...f.request, input: {...f.request.input, ...patch}} as never, f.authority)).ok, false);
  }
  for (const change of [{clientId: "ordinary"}, {context: {workspaceId: createWorkspaceId("another")}}, {isCurrent: () => false}, {stillAllowed: async () => false}]) {
    const f = fixture(); assert.equal((await app.execute(f.request, {...f.authority, ...change} as never)).ok, false);
  }
  for (const position of ["outer", "input", "reference", "getter"]) {
    const f = fixture(); let request = f.request;
    if (position === "outer") request = new Proxy(request, {getPrototypeOf() {getters++; return Object.prototype;}});
    if (position === "input") request = {...request, input: new Proxy(request.input, {getPrototypeOf() {getters++; return Object.prototype;}})};
    if (position === "reference") request = {...request, input: {...request.input, reference: new Proxy(request.input.reference, {getPrototypeOf() {getters++; return Object.prototype;}})}};
    if (position === "getter") request = {...request, input: Object.defineProperty({...request.input}, "query", {enumerable: true, get() {getters++; return f.request.input.query;}})};
    assert.equal((await app.execute(request, f.authority)).ok, false);
  }
  assert.equal(reads, 0); assert.equal(getters, 0);
});

test("permission retirement during any awaited policy check withholds metadata and results", async () => {
  for (const retireAt of [1, 2, 3]) {
    const f = fixture(); let live = true, checks = 0, reads = 0;
    const app = new PreviewHeadlessContextQueryUseCase(async () => {reads++; return f.facts;});
    const result = await app.execute(f.request, {...f.authority, isCurrent: () => live,
      stillAllowed: async () => {if (++checks === retireAt) {await Promise.resolve(); live = false;} return true;}});
    assert.deepEqual(result, {ok: false, code: "headless.forbidden"}); assert.equal(checks, retireAt);
    assert.equal(reads, retireAt === 1 ? 0 : 1);
  }
});

test("unavailable, malformed and private metadata errors never disclose the question or a path", async () => {
  for (const raw of [undefined, {modelRecordId: "", modelUpdatedAt: "bad", sourceCount: 1}, {...fixture().facts, localPath: "private/model"}, "throws"]) {
    const f = fixture();
    const app = new PreviewHeadlessContextQueryUseCase(async () => {if (raw === "throws") throw new Error(f.request.input.query + " private/model"); return raw;});
    const result = await app.execute(f.request, f.authority); assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /Synthetic private|private\/model|"query"/);
  }
});
