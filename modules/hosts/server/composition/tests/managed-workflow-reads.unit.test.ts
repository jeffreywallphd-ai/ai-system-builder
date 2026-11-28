import assert from "node:assert/strict";
import test from "node:test";
import {composeManagedAgentReads} from "../composeManagedAgentReads";
import {createOrganizationId, type OrganizationRole} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {normalizeConversationSessionId, normalizeConversationTurnId} from "../../../../contracts/conversations";
import {normalizeExecutionRunId} from "../../../../contracts/execution-runs";
import {HEADLESS_CONTRACT_VERSION, parseHeadlessReadRequest, type HeadlessReadRequest,
  type HeadlessHostIncarnationId} from "../../../../contracts/headless";

const host = "7b492309-46a0-41c1-bc23-600844758726" as HeadlessHostIncarnationId;
const organizationId = createOrganizationId("workflow-org"), workspaceId = createWorkspaceId("workflow-workspace");
const profile = {profileId: "builtin.workflow.conversation@1.0.0", title: "Controlled conversation" as const,
  source: {kind: "reviewed-execution-plan" as const, sourceId: "plan.one", sourceRevision: "plan-r1"},
  availability: "available" as const, blockers: []};
const denied = {ok: false, code: "headless.forbidden"};
function request(operation: "host.describe" | "workflows.list" | "workflows.prepare" | "conversation-tasks.read") {
  const input = operation === "host.describe" ? {} : {hostIncarnationId: host, workspaceId,
    ...(operation === "workflows.list" ? {sourceKind: "reviewed-execution-plan"} :
      operation === "workflows.prepare" ? {profileId: profile.profileId, source: {...profile.source}} : {sessionId: "session.one", turnId: "turn.one"})};
  const parsed = parseHeadlessReadRequest({version: HEADLESS_CONTRACT_VERSION, operation, input}, host);
  assert.ok(parsed.ok); if (!parsed.ok) throw new Error("Invalid fixture request.");
  return parsed.request;
}
function fixture(configured = true) {
  const state = {current: true, role: "operator" as OrganizationRole | undefined, deny: false,
    workspacePresent: true, foreignWorkspace: false, approvedHandles: false,
    factories: 0, metadataReads: 0, statusReads: 0, scopes: [] as (readonly string[])[],
    onFactory: undefined as (() => Promise<void> | void) | undefined,
    onRead: undefined as (() => void) | undefined, onAuthorize: undefined as (() => void) | undefined};
  let context = {organizationId, principalId: "principal.one"};
  const client = {organizationId, principalId: "principal.one", purpose: "agent" as "agent" | "plan-review",
    registeredClientId: "15898512-a378-4001-adce-1093523c57ac"};
  const targets: unknown[] = [];
  let statusOwner: Awaited<ReturnType<NonNullable<Parameters<typeof composeManagedAgentReads>[0]["getConversationStatus"]>>> | undefined;
  const workflows: Awaited<ReturnType<NonNullable<Parameters<typeof composeManagedAgentReads>[0]["getWorkflowMetadata"]>>> = {
    async list(id, kind, access) {
      assert.equal(this, workflows);
      state.metadataReads++; targets.push([id, kind]);
      assert.deepEqual(access.context.roles, ["operator"]);
      assert.equal(access.canDiscoverApprovedTurns, undefined);
      assert.equal(await access.canRead(id, kind), true);
      state.onRead?.(); return {ok: true, value: [profile]};
    },
    async prepare(id, target, access) {
      assert.equal(this, workflows);
      state.metadataReads++; targets.push([id, structuredClone(target)]);
      assert.equal(access.canDiscoverApprovedTurns, undefined);
      assert.equal(await access.canRead(id, "reviewed-execution-plan"), true);
      state.onRead?.(); return {ok: true, value: {profile, snapshotRevision: "snapshot.one", actions: [],
        ...(state.approvedHandles ? {approvedSessionIds: ["session.private"]} : {})}};
    },
  };
  const options: Parameters<typeof composeManagedAgentReads>[0] = {
    hostIncarnationId: host, contexts: {getCurrentOrganizationContext: () => context},
    workspaces: {async readWorkspace(id) {return state.workspacePresent ? {workspaceId: id,
      organizationId: state.foreignWorkspace ? createOrganizationId("other-org") : organizationId,
      displayName: "Synthetic", status: "active", createdAt: "2026-11-28T00:00:00Z", updatedAt: "2026-11-28T00:00:00Z"} : undefined;}},
    authorization: {async authorizeWorkspaceOperation(input) {
      state.scopes.push(input.requiredScopes); state.onAuthorize?.();
      if (state.deny) throw new Error("Private policy diagnostic.");
    }},
    systems: {listTemplates: {async execute() {return []; }}, read: {async execute() {throw new Error("Unexpected system read.");}}},
    ...(configured ? {
      async readWorkflowRole(actor) {assert.ok(Object.isFrozen(actor)); assert.deepEqual(actor, {organizationId, principalId: "principal.one"}); return state.role;},
      async getWorkflowMetadata() {state.factories++; await state.onFactory?.(); return workflows;},
      async getConversationStatus() {state.factories++; await state.onFactory?.(); statusOwner = {
        async read(id, sessionId, turnId, allowed) {
          assert.equal(this, statusOwner);
          state.statusReads++; targets.push([id, sessionId, turnId]); assert.equal(await allowed(), true);
          state.onRead?.(); return {ok: true as const, value: {sessionId: normalizeConversationSessionId(sessionId),
            turnId: normalizeConversationTurnId(turnId), turnStatus: "succeeded" as const,
            run: {runId: normalizeExecutionRunId("run.one"), status: "succeeded" as const}}};
        },
      }; return statusOwner;},
    } : {}),
  };
  const read = composeManagedAgentReads(options);
  return {state, client, options, targets, read: (input: HeadlessReadRequest) => read(input, client, () => state.current),
    changeContext() {context = {...context, principalId: "principal.other"};},
    replaceResolvedReader(operation: "workflows.list" | "workflows.prepare" | "conversation-tasks.read") {
      const owner = operation === "conversation-tasks.read" ? statusOwner : workflows;
      assert.ok(owner);
      Object.defineProperty(owner, operation === "conversation-tasks.read" ? "read" : operation === "workflows.list" ? "list" : "prepare",
        {value: async () => {throw new Error("Replaced original reader must not run.");}});
    }};
}

test("Managed discovery advertises only configured original readers for registered agents", async () => {
  for (const configured of [false, true]) {
    const f = fixture(configured), result = await f.read(request("host.describe"));
    assert.ok(result.ok && result.operation === "host.describe");
    if (result.ok && result.operation === "host.describe")
      assert.equal(result.value.operations.includes("workflows.prepare"), configured);
    if (!configured) assert.deepEqual(await f.read(request("workflows.list")), {ok: false, code: "headless.unsupported-operation"});
    assert.equal(f.state.factories, 0);
  }
});
test("Managed metadata and exact saved status reuse read ports and require runtime read scope", async () => {
  const f = fixture();
  for (const operation of ["workflows.list", "workflows.prepare", "conversation-tasks.read"] as const) {
    const result = await f.read(request(operation)); assert.ok(result.ok && result.operation === operation);
    assert.equal(JSON.stringify(result).includes("session.private"), false);
  }
  assert.equal(f.state.metadataReads, 2); assert.equal(f.state.statusReads, 1);
  assert.ok(f.state.scopes.length > 3);
  for (const scopes of f.state.scopes) assert.deepEqual(scopes, ["workspace:read", "asset:read", "runtime:read"]);
  assert.deepEqual(f.targets[2], [workspaceId, "session.one", "turn.one"]);
});
test("wrong purpose, missing registration, tenant and permission fail before reader resolution", async () => {
  for (const change of [(f: ReturnType<typeof fixture>) => {f.client.purpose = "plan-review";},
    (f: ReturnType<typeof fixture>) => {f.client.registeredClientId = "invalid";},
    (f: ReturnType<typeof fixture>) => f.changeContext(),
    (f: ReturnType<typeof fixture>) => {f.state.foreignWorkspace = true;},
    (f: ReturnType<typeof fixture>) => {f.state.workspacePresent = false;},
    (f: ReturnType<typeof fixture>) => {f.state.deny = true;}]) {
    const f = fixture(); change(f);
    assert.deepEqual(await f.read(request("workflows.prepare")), denied); assert.equal(f.state.factories, 0);
  }
});
test("role and registration changes after asynchronous metadata reads prevent disclosure", async () => {
  for (const change of [(f: ReturnType<typeof fixture>) => {f.state.role = "member";},
    (f: ReturnType<typeof fixture>) => {f.state.current = false;},
    (f: ReturnType<typeof fixture>) => {f.client.principalId = "principal.other";},
    (f: ReturnType<typeof fixture>) => {f.state.deny = true;},
    (f: ReturnType<typeof fixture>) => f.changeContext()]) {
    const f = fixture(); f.state.onRead = () => change(f);
    assert.deepEqual(await f.read(request("workflows.prepare")), denied); assert.equal(f.state.metadataReads, 1);
  }
});
test("factory waits cannot carry a changed role or disclose an expired saved status", async () => {
  const metadata = fixture(); metadata.state.onFactory = () => {metadata.state.role = "member";};
  assert.deepEqual(await metadata.read(request("workflows.list")), denied); assert.equal(metadata.state.metadataReads, 0);
  const status = fixture(); status.state.onRead = () => {status.state.current = false;};
  assert.deepEqual(await status.read(request("conversation-tasks.read")), denied); assert.equal(status.state.statusReads, 1);
});
test("captured workflow target and original reader identity survive caller mutation", async () => {
  const f = fixture(); let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => {release = resolve;}), atFactory = new Promise<void>(resolve => {entered = resolve;});
  f.state.onFactory = async () => {entered(); await waiting;};
  const raw = {version: HEADLESS_CONTRACT_VERSION, operation: "workflows.prepare" as const,
    input: {hostIncarnationId: host, workspaceId, profileId: profile.profileId, source: {...profile.source}}} satisfies HeadlessReadRequest;
  const pending = f.read(raw); await atFactory;
  raw.input.source.sourceRevision = "changed"; raw.input.workspaceId = createWorkspaceId("other-workspace");
  Object.defineProperty(f.options, "getWorkflowMetadata", {value: async () => {throw new Error("Replacement reader must not run.");}});
  release(); const result = await pending; assert.ok(result.ok);
  assert.deepEqual(f.targets, [[workspaceId, {profileId: profile.profileId, source: profile.source}]]);
});
test("read metadata cannot disclose separate approved-conversation handles", async () => {
  const f = fixture(); f.state.approvedHandles = true;
  assert.deepEqual(await f.read(request("workflows.prepare")), {ok: false, code: "headless.unavailable"});
});
test("permission waits cannot replace methods on the original resolved readers", async () => {
  for (const operation of ["workflows.list", "workflows.prepare", "conversation-tasks.read"] as const) {
    const f = fixture();
    f.state.onAuthorize = () => {if (f.state.factories > 0) f.replaceResolvedReader(operation);};
    const result = await f.read(request(operation));
    assert.ok(result.ok && result.operation === operation);
    assert.equal(f.state.metadataReads + f.state.statusReads, 1);
  }
});
