import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {HEADLESS_CONTRACT_VERSION, type HeadlessContextSavedRequest} from "../../../../contracts/headless";
import {ReadHeadlessContextSavedUseCase} from "../headless-context-saved.use-case";

function fixture() {
  const context = {organizationId: createOrganizationId("org.synthetic"), principalId: "principal.synthetic",
    workspaceId: createWorkspaceId("workspace.synthetic")};
  const contextId = randomUUID(), taskId = randomUUID(), clientId = randomUUID();
  const request: HeadlessContextSavedRequest = {version: HEADLESS_CONTRACT_VERSION, operation: "context.saved",
    input: {hostIncarnationId: randomUUID(), workspaceId: context.workspaceId, contextId}};
  const value = {reference: {workspaceId: context.workspaceId, contextId, taskId, kind: "markdown-context-pack",
    artifactDigest: "sha256:" + "a".repeat(64)}, name: "Synthetic context", sizeBytes: 10, sourceCount: 1, chunkCount: 2,
    byteAvailability: "not-checked"};
  return {context, clientId, request, value};
}

test("saved Context read returns detached finite metadata and never asserts byte or runtime readiness", async () => {
  const f = fixture(); let reads = 0, checks = 0;
  const app = new ReadHeadlessContextSavedUseCase(async (request, actor) => {
    reads++; assert.deepEqual(request, f.request); assert.deepEqual(actor, f.context);
    assert.ok(Object.isFrozen(request.input)); assert.ok(Object.isFrozen(actor));
    return f.value;
  });
  const result = await app.execute(f.request, {context: f.context, clientId: f.clientId, stillAllowed: async () => {checks++; return true;}});
  assert.deepEqual(result, {ok: true, operation: "context.saved", value: f.value});
  assert.equal(reads, 1); assert.equal(checks, 2);
  if (result.ok) {assert.notStrictEqual(result.value, f.value); assert.notStrictEqual(result.value.reference, f.value.reference);}
});

test("saved Context read denies wrong actors, clients and workspace before metadata access", async () => {
  const f = fixture(); let reads = 0;
  const app = new ReadHeadlessContextSavedUseCase(async () => {reads++; return f.value;});
  const authority = {context: f.context, clientId: f.clientId, stillAllowed: async () => true};
  for (const context of [{...f.context, organizationId: undefined}, {...f.context, principalId: undefined},
    {...f.context, workspaceId: createWorkspaceId("workspace.foreign")}])
    assert.deepEqual(await app.execute(f.request, {...authority, context}), {ok: false, code: "headless.forbidden"});
  assert.deepEqual(await app.execute(f.request, {...authority, clientId: "not-a-client"}), {ok: false, code: "headless.forbidden"});
  assert.deepEqual(await app.execute(f.request, {...authority, stillAllowed: async () => false}), {ok: false, code: "headless.forbidden"});
  assert.equal(reads, 0);
});

test("saved Context read withholds a late reply when authorization changes during metadata access", async () => {
  const f = fixture(); let allowed = true;
  const app = new ReadHeadlessContextSavedUseCase(async () => {allowed = false; return f.value;});
  assert.deepEqual(await app.execute(f.request, {context: f.context, clientId: f.clientId, stillAllowed: async () => allowed}),
    {ok: false, code: "headless.forbidden"});
});

test("saved Context metadata cannot substitute identities, private fields or an untested readiness claim", async () => {
  const f = fixture(); let value: unknown;
  const app = new ReadHeadlessContextSavedUseCase(async () => value);
  const authority = {context: f.context, clientId: f.clientId, stillAllowed: async () => true};
  for (value of [{...f.value, path: "private"}, {...f.value, byteAvailability: "verified"},
    {...f.value, reference: {...f.value.reference, contextId: randomUUID()}},
    {...f.value, reference: {...f.value.reference, workspaceId: "workspace.foreign"}},
    {...f.value, reference: {...f.value.reference, storageKey: "private"}}, {...f.value, sizeBytes: -1}])
    assert.deepEqual(await app.execute(f.request, authority), {ok: false, code: "headless.unavailable"});
  value = undefined;
  assert.deepEqual(await app.execute(f.request, authority), {ok: false, code: "headless.not-found"});
});

test("saved Context metadata access captures request and actor values before an asynchronous boundary", async () => {
  const f = fixture(), expected = structuredClone(f.request), actor = {...f.context};
  const app = new ReadHeadlessContextSavedUseCase(async (request, context) => {
    assert.deepEqual(request, expected); assert.deepEqual(context, actor); return f.value;
  });
  let first = true;
  const result = await app.execute(f.request, {context: f.context, clientId: f.clientId, stillAllowed: async () => {
    if (first) {first = false; (f.request.input as {contextId: string}).contextId = randomUUID();
      f.context.workspaceId = createWorkspaceId("workspace.foreign");}
    return true;
  }});
  assert.deepEqual(result, {ok: true, operation: "context.saved", value: f.value});
});

test("saved Context malformed inputs and adapter errors reveal no getter, path or policy details", async () => {
  const f = fixture(); let getters = 0, reads = 0;
  const app = new ReadHeadlessContextSavedUseCase(async () => {reads++; throw new Error("private fixture path");});
  const authority = {context: f.context, clientId: f.clientId, stillAllowed: async () => true};
  const accessor = {...f.request};
  Object.defineProperty(accessor, "input", {enumerable: true, get() {getters++; return f.request.input;}});
  assert.deepEqual(await app.execute(accessor, authority), {ok: false, code: "headless.unavailable"});
  assert.equal(getters, 0); assert.equal(reads, 0);
  assert.deepEqual(await app.execute(f.request, authority), {ok: false, code: "headless.unavailable"});
  assert.equal(reads, 1);
  assert.deepEqual(await app.execute(f.request, {...authority, stillAllowed: async () => {throw new Error("private policy");}}),
    {ok: false, code: "headless.forbidden"});
  assert.equal(reads, 1);
});
