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
