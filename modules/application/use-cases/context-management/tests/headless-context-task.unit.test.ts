import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {HEADLESS_CONTRACT_VERSION, type HeadlessContextTaskRequest} from "../../../../contracts/headless";
import {ReadHeadlessContextTaskUseCase} from "../headless-context-task.use-case";

function fixture() {
  const context = {organizationId: createOrganizationId("org.synthetic"), principalId: "principal.synthetic",
    workspaceId: createWorkspaceId("workspace.synthetic")};
  const taskId = randomUUID(), clientId = randomUUID();
  const request: HeadlessContextTaskRequest = {version: HEADLESS_CONTRACT_VERSION, operation: "context.task",
    input: {hostIncarnationId: randomUUID(), workspaceId: context.workspaceId, selection: {kind: "task", taskId}}};
  return {context, taskId, clientId, request};
}

function queryValue(taskId: string) {
  return {taskId, state: "succeeded", review: null, query: {queryDigest: "sha256:" + "a".repeat(64), maximumResults: 3,
    embeddingDevice: "cpu", sources: [{reference: {kind: "ingestion-file", taskId: "task.synthetic", fileId: "file.synthetic", taskRevision: 1},
      digest: "sha256:" + "b".repeat(64)}], matches: [{rank: 1, score: 0.9, sourceOrdinal: 1, chunkIndex: 0}], cleanupPending: false}};
}

test("query association requires fresh model permission before processor access, without narrowing generation reads", async () => {
  const f = fixture(), value = queryValue(f.taskId); let reads = 0, modelAllowed = false;
  const app = new ReadHeadlessContextTaskUseCase(async () => ({family: "query", taskId: f.taskId}), async (id, actor, policy, family, live) => {
    reads++; assert.equal(id, f.taskId); assert.deepEqual(actor, f.context); assert.equal(family, "query");
    assert.equal(await policy(), true); assert.equal(live(), true); return value;
  });
  const authority = {context: f.context, clientId: f.clientId, stillAllowed: async () => true};
  assert.deepEqual(await app.execute(f.request, authority), {ok: false, code: "headless.forbidden"});
  assert.deepEqual(await app.execute(f.request, {...authority, queryStillAllowed: async () => modelAllowed}), {ok: false, code: "headless.forbidden"});
  assert.equal(reads, 0); modelAllowed = true;
  assert.deepEqual(await app.execute(f.request, {...authority, queryStillAllowed: async () => modelAllowed}),
    {ok: true, operation: "context.task", value}); assert.equal(reads, 1);
  const generation = new ReadHeadlessContextTaskUseCase(async () => f.taskId, async () => ({taskId: f.taskId, state: "running", review: null}));
  assert.equal((await generation.execute(f.request, authority)).ok, true);
  const forged = new ReadHeadlessContextTaskUseCase(async () => f.taskId, async () => value);
  assert.deepEqual(await forged.execute(f.request, {...authority, queryStillAllowed: async () => true}), {ok: false, code: "headless.unavailable"});
});

test("new query requests use fresh registration policy instead of retaining an earlier failed request", async () => {
  const f = fixture(), value = queryValue(f.taskId); let reads = 0;
  const app = new ReadHeadlessContextTaskUseCase(async () => ({family: "query", taskId: f.taskId}), async () => {reads++; return value;});
  assert.equal((await app.execute(f.request, {context: f.context, clientId: f.clientId, stillAllowed: async () => false,
    queryStillAllowed: async () => false, isCurrent: () => false})).ok, false);
  assert.equal(reads, 0);
  assert.deepEqual(await app.execute(f.request, {context: f.context, clientId: f.clientId, stillAllowed: async () => true,
    queryStillAllowed: async () => true, isCurrent: () => true}), {ok: true, operation: "context.task", value});
  assert.equal(reads, 1);
});

test("query permission retirement after helper resolution fences provider and final publication", async () => {
  for (const boundary of ["before-read", "after-read"]) {
    const f = fixture(); let live = true, reads = 0, checks = 0;
    const app = new ReadHeadlessContextTaskUseCase(async () => ({family: "query", taskId: f.taskId}), async () => {
      reads++; return queryValue(f.taskId);
    });
    const result = await app.execute(f.request, {context: f.context, clientId: f.clientId, stillAllowed: async () => true,
      isCurrent: () => live, queryStillAllowed: async () => {
        if (++checks === (boundary === "before-read" ? 1 : 2)) queueMicrotask(() => queueMicrotask(() => {live = false;}));
        return true;
      }});
    assert.deepEqual(result, {ok: false, code: "headless.forbidden"});
    assert.equal(reads, boundary === "before-read" ? 0 : 1);
  }
});

test("Context task lookup proves accepted ownership before processor access and rechecks authority at each boundary", async () => {
  const {context, taskId, clientId, request} = fixture();
  let accepted: string | undefined = taskId, current = true, retireAfterLookup = false, retireAfterRead = false;
  let lookups = 0, reads = 0;
  let result: unknown = {taskId, state: "running", review: null};
  const app = new ReadHeadlessContextTaskUseCase(async (exact, actor, client) => {
    lookups++; assert.deepEqual(exact, request); assert.deepEqual(actor, context); assert.equal(client, clientId);
    if (retireAfterLookup) current = false;
    return accepted;
  }, async (id, actor) => {
    reads++; assert.equal(id, taskId); assert.deepEqual(actor, context);
    if (retireAfterRead) current = false;
    return result;
  });
  const authority = {context, clientId, stillAllowed: async () => current};
  assert.deepEqual(await app.execute(request, authority), {ok: true, operation: "context.task", value: result});
  assert.equal(reads, 1);
  for (accepted of [undefined, "not-an-owned-id", randomUUID()]) {
    assert.deepEqual(await app.execute(request, authority), {ok: false, code: "headless.forbidden"});
    assert.equal(reads, 1);
  }
  accepted = taskId; current = false;
  const before = lookups;
  assert.deepEqual(await app.execute(request, authority), {ok: false, code: "headless.forbidden"});
  assert.equal(lookups, before);
  current = true; retireAfterLookup = true;
  assert.deepEqual(await app.execute(request, authority), {ok: false, code: "headless.forbidden"}); assert.equal(reads, 1);
  current = true; retireAfterLookup = false; retireAfterRead = true;
  assert.deepEqual(await app.execute(request, authority), {ok: false, code: "headless.forbidden"}); assert.equal(reads, 2);
  current = true; retireAfterRead = false;
  for (result of [{taskId: randomUUID(), state: "running", review: null}, {taskId, state: "running", review: null, path: "private"},
    {taskId, state: "review-required", review: null}])
    assert.deepEqual(await app.execute(request, authority), {ok: false, code: "headless.unavailable"});
});

test("an exact accepted plan-step lookup discloses only reviewed counters and survives no identity substitution", async () => {
  const {context, taskId, clientId, request} = fixture();
  const selected = {...request, input: {...request.input, selection: {kind: "plan-step" as const, fingerprint: "a".repeat(64), step: 2}}};
  const expectedContext = {...context};
  const review = {kind: "markdown-context-pack", reportFingerprint: "b".repeat(64), sourceCount: 2,
    chunkCount: 7, sizeBytes: 1000, requiresExplicitSave: true};
  const value = {taskId, state: "review-required", review};
  const app = new ReadHeadlessContextTaskUseCase(async (exact, actor) => {
    assert.equal(exact.input.selection.kind, "plan-step");
    assert.equal(Object.isFrozen(exact.input.selection), true); assert.equal(Object.isFrozen(actor), true);
    context.workspaceId = createWorkspaceId("workspace.foreign");
    selected.input.selection.fingerprint = "c".repeat(64);
    return taskId;
  }, async (id, actor) => {
    assert.equal(id, taskId); assert.deepEqual(actor, expectedContext);
    return value;
  });
  assert.deepEqual(await app.execute(selected, {context, clientId, stillAllowed: async () => true}),
    {ok: true, operation: "context.task", value});
});

test("missing actor/client scope, malformed passive input and adapter failure cannot reveal task details", async () => {
  const {context, taskId, clientId, request} = fixture();
  let calls = 0, getters = 0;
  const app = new ReadHeadlessContextTaskUseCase(async () => {calls++; throw new Error("private fixture path");},
    async () => {assert.fail("No processor access without accepted proof.");});
  const authority = {context, clientId, stillAllowed: async () => true};
  for (const changed of [{...context, organizationId: undefined}, {...context, principalId: undefined},
    {...context, workspaceId: createWorkspaceId("workspace.foreign")}])
    assert.deepEqual(await app.execute(request, {...authority, context: changed}), {ok: false, code: "headless.forbidden"});
  assert.deepEqual(await app.execute(request, {...authority, clientId: "not-a-client"}), {ok: false, code: "headless.forbidden"});
  const accessor = {...request};
  Object.defineProperty(accessor, "input", {enumerable: true, get() {getters++; return request.input;}});
  assert.deepEqual(await app.execute(accessor, authority), {ok: false, code: "headless.unavailable"});
  assert.equal(getters, 0); assert.equal(calls, 0);
  assert.deepEqual(await app.execute(request, authority), {ok: false, code: "headless.unavailable"}); assert.equal(calls, 1);
  assert.deepEqual(await app.execute(request, {...authority, stillAllowed: async () => {throw new Error("private policy failure");}}),
    {ok: false, code: "headless.forbidden"});
  assert.equal(calls, 1); assert.ok(taskId);
});
