import assert from "node:assert/strict";
import {once} from "node:events";
import test, {type TestContext} from "node:test";
import express from "express";
import {registerManagedHeadlessAgentRoutes, type ManagedAgentRouteHandlers} from "../registerManagedHeadlessAgentRoutes";
import {HEADLESS_CONTRACT_VERSION, type HeadlessHostIncarnationId, type HeadlessReadRequest, type HeadlessReadResult} from "../../../../../contracts/headless";
import {createWorkspaceId} from "../../../../../contracts/workspace";
const hostIncarnationId = "0a90193f-bb8a-4021-ade2-c23395a50e9b" as HeadlessHostIncarnationId;
const workspaceId = createWorkspaceId("workflow-route-workspace");
const profile = {profileId: "builtin.workflow.conversation@1.0.0", title: "Controlled conversation",
  source: {kind: "reviewed-execution-plan", sourceId: "plan.one", sourceRevision: "revision.one"}, availability: "available", blockers: []};
function input(operation: "workflows.prepare" | "conversation-tasks.read" | "workflows.list" | "host.describe") {
  return {version: HEADLESS_CONTRACT_VERSION, operation, input: operation === "host.describe" ? {} : {hostIncarnationId, workspaceId,
    ...(operation === "workflows.prepare" ? {profileId: profile.profileId, source: {...profile.source}} : operation === "workflows.list"
      ? {sourceKind: "reviewed-execution-plan"} : {sessionId: "session.one", turnId: "turn.one"})}};
}
function reply(operation: string): unknown {
  return {ok: true, operation, value: operation === "workflows.prepare" ? {profile: structuredClone(profile), snapshotRevision: "snapshot.one", actions: []}
    : operation === "workflows.list" ? [structuredClone(profile)] : operation === "host.describe"
      ? {version: HEADLESS_CONTRACT_VERSION, hostIncarnationId, workspaces: [], operations: ["host.describe", "workflows.prepare", "conversation-tasks.read"]}
      : {sessionId: "session.one", turnId: "turn.one", turnStatus: "succeeded", run: {runId: "run.one", status: "succeeded"}}};
}
async function fixture(t: TestContext) {
  const app = express(), agent = {};
  const state = {enabled: false, alive: true, calls: 0,
    read: async (request: HeadlessReadRequest): Promise<unknown> => reply(request.operation)};
  const handlers: ManagedAgentRouteHandlers<typeof agent> = {hostIncarnationId, identify: () => agent, isCurrent: () => state.alive,
    get allowWorkflowReads() {return state.enabled;},
    async read(request) {state.calls++; return await state.read(request) as HeadlessReadResult;},
    async author() {throw new Error("A workflow read must not author anything.");}};
  const retire = registerManagedHeadlessAgentRoutes(app, () => handlers), server = app.listen(0, "127.0.0.1");
  t.after(async () => {retire(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));});
  await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  return {state, async post(body: unknown) {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/headless/agent/read`,
      {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)});
    return {status: response.status, value: await response.json()};
  }};
}
test("Managed workflow HTTP reads remain unavailable until trusted host composition enables them", async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.post(input("workflows.prepare")), {status: 400, value: {ok: false, code: "headless.unsupported-operation"}});
  assert.equal(f.state.calls, 0); f.state.enabled = true;
  for (const operation of ["workflows.list", "workflows.prepare", "conversation-tasks.read"] as const)
    assert.deepEqual(await f.post(input(operation)), {status: 200, value: reply(operation)});
});
test("Managed workflow HTTP discovery releases only configured read operations", async t => {
  const f = await fixture(t);
  const first = await f.post(input("host.describe"));
  assert.equal((first.value as {value: {operations: string[]}}).value.operations.includes("workflows.prepare"), false);
  f.state.enabled = true;
  const second = await f.post(input("host.describe"));
  assert.equal((second.value as {value: {operations: string[]}}).value.operations.includes("workflows.prepare"), true);
});
test("Managed workflow HTTP projection denies private fields and separately approved session handles", async t => {
  const f = await fixture(t); f.state.enabled = true;
  for (const field of [{privatePrompt: "private"}, {approvedSessionIds: []}]) {
    f.state.read = async () => {const raw = reply("workflows.prepare") as {value: object}; return {...raw, value: {...raw.value, ...field}};};
    assert.deepEqual(await f.post(input("workflows.prepare")), {status: 503, value: {ok: false, code: "headless.unavailable"}});
  }
});
test("Managed workflow HTTP reply correlation is independent of a handler-mutated request", async t => {
  const f = await fixture(t); f.state.enabled = true;
  f.state.read = async request => {
    assert.equal(request.operation, "workflows.prepare");
    if (request.operation !== "workflows.prepare") throw new Error("Wrong test operation.");
    Object.defineProperty(request.input.source, "sourceRevision", {value: "revision.changed"});
    const raw = reply(request.operation) as {value: {profile: typeof profile}};
    raw.value.profile.source.sourceRevision = "revision.changed"; return raw;
  };
  assert.deepEqual(await f.post(input("workflows.prepare")), {status: 503, value: {ok: false, code: "headless.unavailable"}});
});
test("Managed exact task replies and late permission withdrawal cannot disclose mismatched status", async t => {
  const f = await fixture(t); f.state.enabled = true;
  f.state.read = async () => {const raw = reply("conversation-tasks.read") as {value: {turnId: string}}; raw.value.turnId = "turn.other"; return raw;};
  assert.deepEqual(await f.post(input("conversation-tasks.read")), {status: 503, value: {ok: false, code: "headless.unavailable"}});
  f.state.read = async request => {f.state.alive = false; return reply(request.operation);};
  assert.deepEqual(await f.post(input("workflows.list")), {status: 403, value: {ok: false, code: "headless.forbidden"}});
});
