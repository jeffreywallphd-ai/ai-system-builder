import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createStructuredOrganizationRepositories } from "../../../../adapters/persistence/organization";
import { createLocalWorkspaceRepository } from "../../../../adapters/persistence/workspace";
import { initializeLocalIdentityProfile } from "../../../../adapters/security/local-identity";
import type { IpcMainHandlePort } from "../../../../adapters/transport/ipc-electron/ipcMainHandlePort";
import { HEADLESS_CONTRACT_VERSION as version, HEADLESS_READ_OPERATIONS, isHeadlessHostIncarnationId } from "../../../../contracts/headless";
import { createDesktopSystemBuilderRequest, DESKTOP_SYSTEM_BUILDER_CHANNELS } from "../../../../contracts/ipc";
import { createOrganizationId } from "../../../../contracts/organization";
import type { OrganizationRole } from "../../../../contracts/organization";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { composeDesktopHeadlessReads, type DesktopHeadlessReadGrant } from "../composeDesktopHeadlessReads";
import { composeDesktopHost } from "../composeDesktopHost";

const workspaceId = createWorkspaceId("fixture-workspace");
const otherWorkspaceId = createWorkspaceId("other-fixture-workspace");
const organizationId = createOrganizationId("fixture-organization");
const principalId = "fixture-principal";
const hostIncarnationId = "41155d53-5771-4870-b31d-574bb19dfb02";
assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));
const at = "2026-11-13T00:00:00.000Z";
const request = (operation: string, input: object) => ({ version, operation, input });
const forbidden = { ok: false, code: "headless.forbidden" };
const grant: DesktopHeadlessReadGrant = {
  organizationId, principalId, registeredClientId: "fixture-client",
  workspaceIds: [workspaceId], operations: HEADLESS_READ_OPERATIONS,
};

test("denies missing, mismatched, stale, or narrowed authority before invoking the builder", async () => {
  let providers = 0;
  let policyChecks = 0;
  let open = true;
  const handler = composeDesktopHeadlessReads({
    hostIncarnationId,
    identity: { organizationId, principalId },
    workspaceRepository: {
      async readWorkspace(id) {
        return { organizationId, workspaceId: id, displayName: "Fixture", status: "active", createdAt: at, updatedAt: at };
      },
    },
    authorization: { async authorizeWorkspaceOperation() { policyChecks++; } },
    getUseCases() { providers++; throw new Error("Internal test detail"); },
    isOpen: () => open,
  });
  const list = request("systems.list", { workspaceId, hostIncarnationId });
  assert.deepEqual(await handler(list, async () => undefined), forbidden);
  assert.deepEqual(await handler(list, async () => ({ ...grant, principalId: "other-fixture" })), forbidden);
  assert.deepEqual(await handler(list, async () => ({ ...grant, operations: ["host.describe"] })), forbidden);
  assert.deepEqual(await handler(list, async () => ({ ...grant, workspaceIds: [otherWorkspaceId] })), forbidden);
  assert.deepEqual(await handler(request("systems.list", {
    workspaceId, hostIncarnationId: "ce8d3876-51f8-48f6-8b83-78fd5d6ef19f",
  }), async () => grant), { ok: false, code: "headless.host-changed" });
  assert.equal(policyChecks, 0);
  let grantReads = 0;
  assert.deepEqual(await handler(list, async () => ++grantReads === 1 ? grant : undefined), forbidden);
  assert.equal(policyChecks, 1);
  assert.equal(providers, 0);
  assert.deepEqual(await handler(list, async () => grant), { ok: false, code: "headless.unavailable" });
  assert.equal(providers, 1);
  open = false;
  assert.deepEqual(await handler(list, async () => { throw new Error("Grant verification should not run"); }), forbidden);
});

test("uses one actual desktop provider, reads IPC-saved state, and omits private details", { timeout: 30_000 }, async () => {
  const parent = await realpath(tmpdir());
  const root = await realpath(await mkdtemp(path.join(parent, "desktop-headless-reads-")));
  const documents = createInMemoryStructuredDocumentStore();
  let stop: (() => Promise<void>) | undefined;
  try {
    let sequence = 0;
    const identity = await initializeLocalIdentityProfile({
      documents, organizationDisplayName: "Fixture", principalDisplayName: "Fixture",
      now: () => at, createId: () => `headless-fixture.${++sequence}`,
    });
    const organizationDocuments = documents.forOrganization(identity.organizationId);
    const workspaces = createLocalWorkspaceRepository({ rootDirectory: root, documents: organizationDocuments });
    await workspaces.saveWorkspace({
      organizationId: identity.organizationId, workspaceId, displayName: "Fixture workspace",
      description: "Synthetic private workspace detail", status: "active", createdAt: at, updatedAt: at,
    });
    await workspaces.saveWorkspace({
      organizationId: identity.organizationId, workspaceId: otherWorkspaceId, displayName: "Unpaired workspace",
      status: "active", createdAt: at, updatedAt: at,
    });
    const host = composeDesktopHost({
      persistence: { documents, organizationDocuments }, localIdentity: identity, now: () => at, logSink() {},
      runtimeDataRootDirectory: root,
      artifactRepo: { huggingFaceTokenConfigFilePath: path.join(root, "no-token.json") },
      settings: { localSettingsFilePath: path.join(root, "settings.json") },
    });
    stop = host.shutdownBackgroundTasks;
    assert.equal(host.getHeadlessReadHandler(), undefined);
    const handlers = new Map<string, Parameters<IpcMainHandlePort["handle"]>[1]>();
    host.registerDesktopIpc({
      ipcMain: { handle(channel, listener) {
        handlers.set(channel, (event, payload) => listener(event, payload as never));
      } },
      senderTrust: { isTrustedSender: () => true }, storageRootDirectory: root,
      runtimeRootDirectory: path.join(root, "runtime"),
    });
    const handler = host.getHeadlessReadHandler();
    assert.ok(handler);
    const verified = async () => ({ ...grant, organizationId: identity.organizationId, principalId: identity.principalId });
    const description = await handler(request("host.describe", {}), verified);
    assert.ok(description.ok && description.operation === "host.describe");
    assert.deepEqual(description.value.workspaces, [workspaceId]);
    const exactHost = description.value.hostIncarnationId;
    const scoped = { hostIncarnationId: exactHost, workspaceId };
    assert.ok(description.value.operations.includes("workflows.list"));
    assert.ok(description.value.operations.includes("conversation-tasks.read"));
    assert.deepEqual(await handler(request("workflows.list", { ...scoped, sourceKind: "reviewed-execution-plan" }), verified), {
      ok: true, operation: "workflows.list", value: [],
    });
    const task = request("conversation-tasks.read", { ...scoped, sessionId: "session.fixture", turnId: "turn.fixture" });
    assert.deepEqual(await handler(task, verified), { ok: false, code: "headless.not-found" });
    assert.deepEqual(await handler(request("workflows.list", {
      ...scoped, workspaceId: otherWorkspaceId, sourceKind: "reviewed-execution-plan",
    }), verified), forbidden);
    assert.ok(description.value.operations.includes("systems.snapshot"));
    const snapshot = await handler(request("systems.snapshot", scoped), verified);
    assert.ok(snapshot.ok && snapshot.operation === "systems.snapshot");
    assert.deepEqual(snapshot.value.systems, []);
    const poll = request("systems.changes", { ...scoped, cursor: snapshot.value.cursor });
    assert.deepEqual(await handler(poll, verified), { ok: true, operation: "systems.changes", value: {
      kind: "changes", events: [], cursor: snapshot.value.cursor, more: false,
    } });
    const otherClient = async () => ({ ...await verified(), registeredClientId: "other-client" });
    assert.deepEqual(await handler(poll, otherClient), { ok: true, operation: "systems.changes", value: { kind: "resync" } });
    assert.deepEqual(await handler(request("systems.snapshot", { ...scoped, workspaceId: otherWorkspaceId }), verified), forbidden);
    const workspacesResult = await handler(request("workspaces.list", { hostIncarnationId: exactHost }), verified);
    assert.deepEqual(workspacesResult, { ok: true, operation: "workspaces.list", value: [
      { workspaceId, displayName: "Fixture workspace" },
    ] });
    assert.deepEqual(await handler(request("systems.list", scoped), verified), { ok: true, operation: "systems.list", value: [] });

    const invoke = handlers.get(DESKTOP_SYSTEM_BUILDER_CHANNELS.create.request.value);
    assert.ok(invoke);
    const created: unknown = await invoke({}, createDesktopSystemBuilderRequest("create", {
      workspaceId, name: "Fixture system", description: "Synthetic private system detail",
    }));
    assert.ok(typeof created === "object" && created !== null && "ok" in created && created.ok === true);
    const after = await handler(request("systems.list", scoped), verified);
    assert.ok(after.ok && after.operation === "systems.list");
    assert.equal(after.value.length, 1);
    const [record] = after.value;
    assert.equal(record?.name, "Fixture system");
    assert.equal(record?.revision, 1);
    const savedSnapshot = await handler(request("systems.snapshot", scoped), verified);
    assert.ok(savedSnapshot.ok && savedSnapshot.operation === "systems.snapshot");
    assert.deepEqual(savedSnapshot.value.systems, [{
      systemId: record!.systemId, recordRevision: 1, revisionId: record!.currentRevisionId ?? null, status: record!.status,
    }]);
    assert.deepEqual(Object.keys(record!).sort(), ["currentRevisionId", "name", "revision", "status", "systemId"]);
    assert.deepEqual(await handler(request("systems.read", { ...scoped, systemId: record!.systemId }), verified), {
      ok: true, operation: "systems.read", value: record,
    });
    assert.deepEqual(await handler(request("systems.list", { ...scoped, workspaceId: otherWorkspaceId }), verified), forbidden);
    const lifecycle = host.getFeatureLifecycleState();
    for (const key of ["runtime-task-registry", "model-registry"]) {
      assert.equal(lifecycle.find((entry) => entry.featureKey === key)?.loaded, false);
    }
    const memberships = createStructuredOrganizationRepositories(documents).memberships;
    const membership = await memberships.readMembership({
      organizationId: identity.organizationId, principalId: identity.principalId,
    });
    assert.ok(membership);
    await memberships.saveMembership({ ...membership, status: "suspended" });
    assert.deepEqual(await handler(task, verified), forbidden);
    assert.deepEqual(await handler(poll, verified), forbidden);
    assert.deepEqual(await handler(request("systems.read", { ...scoped, systemId: record!.systemId }), verified), forbidden);
    const afterSuspension = await handler(request("host.describe", {}), verified);
    assert.ok(afterSuspension.ok && afterSuspension.operation === "host.describe");
    assert.deepEqual(afterSuspension.value.workspaces, []);
    await host.shutdownBackgroundTasks();
    stop = undefined;
    assert.equal(host.getHeadlessReadHandler(), undefined);
    assert.deepEqual(await handler(request("host.describe", {}), verified), forbidden);
  } finally {
    await stop?.();
    const target = await realpath(root);
    assert.equal(target, root);
    assert.equal(path.dirname(target), parent);
    assert.ok(path.basename(target).startsWith("desktop-headless-reads-"));
    await rm(target, { recursive: true, force: true });
  }
});

test("discovery advertises only the grant that remains after the final workspace policy check", async () => {
  let checks = 0;
  let currentGrant = grant;
  const handler = composeDesktopHeadlessReads({
    hostIncarnationId,
    identity: { organizationId, principalId },
    workspaceRepository: {
      async readWorkspace(id) {
        return { organizationId, workspaceId: id, displayName: "Fixture", status: "active", createdAt: at, updatedAt: at };
      },
    },
    authorization: {
      async authorizeWorkspaceOperation() {
        if (++checks === 2) currentGrant = { ...grant, operations: ["host.describe"] };
      },
    },
    getUseCases() { throw new Error("Discovery must not start the System Builder"); },
    isOpen: () => true,
  });
  const result = await handler(request("host.describe", {}), async () => currentGrant);
  assert.ok(result.ok && result.operation === "host.describe");
  assert.equal(checks, 2);
  assert.deepEqual(result.value.operations, ["host.describe"]);
});

test("withholds a role-dependent workflow reply if membership changes during the final policy check", async () => {
  let role: OrganizationRole = "owner";
  let checks = 0;
  let described = false;
  const handler = composeDesktopHeadlessReads({
    hostIncarnationId, identity: { organizationId, principalId },
    workspaceRepository: { async readWorkspace(id) {
      return { organizationId, workspaceId: id, displayName: "Fixture", status: "active", createdAt: at, updatedAt: at };
    } },
    authorization: { async authorizeWorkspaceOperation() { if (++checks === 4) role = "member"; } },
    getUseCases() { assert.fail("The workflow does not need the System Builder."); },
    readWorkflowRole: async () => role,
    workflows: {
      async list(workspace, kind, access) {
        assert.deepEqual(access.context.roles, ["owner"]);
        assert.equal(await access.canRead(workspace, kind), true);
        assert.equal(await access.canRead(workspace, kind), true);
        described = true;
        return { ok: true, value: [] };
      },
      async prepare() { assert.fail("Only discovery is requested."); },
    },
    isOpen: () => true,
  });
  assert.deepEqual(await handler(request("workflows.list", {
    hostIncarnationId, workspaceId, sourceKind: "reviewed-execution-plan",
  }), async () => grant), forbidden);
  assert.equal(described, true);
  assert.equal(role, "member");
});

test("withholds prepared session identifiers if conversation permission is lost before egress", async () => {
  let granted: DesktopHeadlessReadGrant = { ...grant, conversation: true };
  const profileId = "builtin.workflow.conversation@1.0.0";
  const source = { kind: "reviewed-execution-plan", sourceId: "fixture-plan", sourceRevision: "plan-r1" } as const;
  const handler = composeDesktopHeadlessReads({
    hostIncarnationId, identity: { organizationId, principalId },
    workspaceRepository: { async readWorkspace(id) {
      return { organizationId, workspaceId: id, displayName: "Fixture", status: "active", createdAt: at, updatedAt: at };
    } },
    authorization: { async authorizeWorkspaceOperation() {} },
    getUseCases() { assert.fail("Preparing a conversation does not start the System Builder."); },
    readWorkflowRole: async () => "owner",
    workflows: {
      async list() { assert.fail("Only preparation is requested."); },
      async prepare(workspace, _target, access) {
        assert.equal(await access.canDiscoverApprovedTurns?.(workspace), true);
        granted = grant;
        return { ok: true, value: { profile: { profileId, source, title: "Controlled conversation", availability: "available", blockers: [] },
          snapshotRevision: "fixture-snapshot-r1", actions: [], approvedSessionIds: ["session-1"] } };
      },
    },
    isOpen: () => true,
  });
  assert.deepEqual(await handler(request("workflows.prepare", { hostIncarnationId, workspaceId, profileId, source }), async () => granted),
    forbidden);
});
