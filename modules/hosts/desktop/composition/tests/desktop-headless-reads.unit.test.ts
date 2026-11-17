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
import { normalizeIngestionTaskId, normalizeIngestionTaskFileId, normalizeIngestionSourceSnapshotId, normalizeIngestionSha256Digest, type IngestionTaskRecord } from "../../../../contracts/ingestion";
import { composeDesktopHeadlessReads, type DesktopHeadlessReadGrant } from "../composeDesktopHeadlessReads";
import { composeDesktopHost } from "../composeDesktopHost";
import {fixture as datasetFixture, workspaceId as dataWorkspaceId, organizationId as dataOrganizationId,
  principalId as dataPrincipalId, createdAt as dataAt} from "../../../../application/use-cases/dataset-version/tests/headless-dataset-metadata.fixture";

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

test("Desktop preparation previews keep the compiled command private and require a current planning grant", async () => {
  const source = {taskId: normalizeIngestionTaskId("task.preview"), fileId: normalizeIngestionTaskFileId("file.preview"), taskRevision: 3};
  const target = {hostIncarnationId, workspaceId, sources: [source],
    recipe: {kind: "provided-instruction-rows-v1" as const, inputColumn: "question", outputColumn: "answer"},
    split: {trainRatio: 0.8, validationRatio: 0.1, testRatio: 0.1, seed: 42}, qualityPreset: "recommended" as const};
  const preview = {workspaceId, sources: [{...source, sourceSnapshotId: normalizeIngestionSourceSnapshotId("snapshot.preview"),
    format: "csv" as const, sizeBytes: 32, digest: normalizeIngestionSha256Digest("sha256:" + "a".repeat(64)), licenseStatus: "unknown" as const}],
    recipe: target.recipe, split: target.split, qualityPreset: target.qualityPreset, totalBytes: 32,
    maximumRowsPerSource: 1000 as const, outputFormat: "jsonl" as const, reviewRequired: true as const, externalProviderCalls: 0 as const, modelCalls: 0 as const};
  let current: DesktopHeadlessReadGrant = {...grant, planReview: true};
  let opens = 0, allowed = true, extra = false;
  let afterRead: (() => void) | undefined;
  const handler = composeDesktopHeadlessReads({hostIncarnationId, identity: grant,
    workspaceRepository: {async readWorkspace(id) {return {workspaceId: id, organizationId, displayName: "Fixture", status: "active", createdAt: at, updatedAt: at};}},
    authorization: {async authorizeWorkspaceOperation({requiredScopes}) {
      if (requiredScopes.includes("artifact:read") && !allowed) throw new Error("Synthetic denied");
    }},
    getUseCases() {assert.fail("No system or runtime provider is needed.");}, isOpen: () => true,
    async getDatasetInputs() {opens++; return {async execute(input, authority) {
      assert.deepEqual(input, request("data.preview-dataset-preparation", target));
      assert.deepEqual(authority.context, {workspaceId, organizationId, principalId});
      assert.equal(authority.hostIncarnationId, hostIncarnationId);
      if (!await authority.stillAllowed()) return {ok: false, code: "headless.forbidden" as const};
      afterRead?.();
      return {ok: true, prepared: {command: {sourceArtifactIds: ["private-source"]} as never,
        preview: {...preview, ...(extra ? {privateCommand: "private-source"} : {})}}} as const;
    }};},
  });
  const query = request("data.preview-dataset-preparation", target);
  await handler(request("host.describe", {}), async () => current);
  assert.equal(opens, 0);
  assert.deepEqual(await handler(query, async () => grant), forbidden);
  allowed = false;
  assert.deepEqual(await handler(query, async () => current), forbidden);
  assert.equal(opens, 0); allowed = true;
  assert.deepEqual(await handler(query, async () => current), {ok: true, operation: "data.preview-dataset-preparation", value: preview});
  extra = true;
  assert.deepEqual(await handler(query, async () => current), {ok: false, code: "headless.unavailable"});
  extra = false; afterRead = () => {current = grant;};
  assert.deepEqual(await handler(query, async () => current), forbidden);
});

test("Desktop dataset queries stay lazy and use current plan-review, artifact and tenant authority", async () => {
  const {queries} = await datasetFixture(2);
  const plain: DesktopHeadlessReadGrant = {...grant, principalId: dataPrincipalId, organizationId: dataOrganizationId, workspaceIds: [dataWorkspaceId]};
  let current: DesktopHeadlessReadGrant = {...plain, planReview: true};
  let opens = 0, allowed = true;
  let afterRead: (() => void) | undefined;
  const handler = composeDesktopHeadlessReads({hostIncarnationId, identity: plain,
    workspaceRepository: {async readWorkspace(id) {return id === dataWorkspaceId ? {workspaceId: id,
      organizationId: dataOrganizationId, displayName: "Fixture", status: "active", createdAt: dataAt, updatedAt: dataAt} : undefined;}},
    authorization: {async authorizeWorkspaceOperation({requiredScopes}) {
      if (requiredScopes.includes("artifact:read") && !allowed) throw new Error("Synthetic denied");
    }},
    getUseCases() {assert.fail("No system read is needed.");}, isOpen: () => true,
    async getDatasetQueries() {opens++; return {async execute(input, authority) {
      const result = await queries.execute(input, authority); afterRead?.(); return result;
    }};},
  });
  const description = await handler(request("host.describe", {}), async () => current);
  assert.ok(description.ok && description.operation === "host.describe" && description.value.operations.includes("data.dataset-versions"));
  assert.equal(opens, 0);
  for (const [operation, target] of [["data.dataset-versions", {datasetId: "dataset.synthetic", versionIds: ["version.001"]}],
    ["data.compare-dataset-versions", {fromVersionId: "version.001", toVersionId: "version.002"}]] as const) {
    const query = request(operation, {hostIncarnationId, workspaceId: dataWorkspaceId, ...target});
    assert.deepEqual(await handler(query, async () => plain), forbidden);
    allowed = false;
    const initial = opens;
    assert.deepEqual(await handler(query, async () => current), forbidden);
    assert.equal(opens, initial);
    allowed = true;
    const result = await handler(query, async () => current);
    assert.ok(result.ok && result.operation === operation);
    assert.ok(!JSON.stringify(result).includes("private"));
    afterRead = () => {current = plain;};
    assert.deepEqual(await handler(query, async () => current), forbidden);
    current = {...plain, planReview: true};
    afterRead = () => {allowed = false;};
    assert.deepEqual(await handler(query, async () => current), forbidden);
    allowed = true; afterRead = undefined;
  }
});

test("Data status needs plan-review and current artifact permission without warming Data on discovery", async () => {
  let opens = 0;
  let reads = 0;
  let canRead = true;
  let currentGrant = { ...grant, planReview: true as const } as DesktopHeadlessReadGrant;
  let afterRead: (() => void) | undefined;
  const taskId = normalizeIngestionTaskId("intake.synthetic");
  let task: IngestionTaskRecord = {
    schemaVersion: "1.0", organizationId, workspaceId, taskId, kind: "file-batch", status: "queued", revision: 1,
    files: [{fileId: normalizeIngestionTaskFileId("file.synthetic"), checkpointId: "private-checkpoint",
      fileName: "private-source.txt", mediaType: "text/plain", totalBytes: 4, status: "pending", acceptedBytes: 0, nextChunkIndex: 0}],
    cleanupPending: false, createdAt: at, updatedAt: at,
    progress: {completedItems: 0, totalItems: 1, acceptedBytes: 0, totalBytes: 4, percent: 0, message: "private-detail"},
  };
  const handler = composeDesktopHeadlessReads({
    hostIncarnationId, identity: {organizationId, principalId},
    workspaceRepository: {async readWorkspace(id) {
      return {workspaceId: id, organizationId, displayName: "Fixture", status: "active", createdAt: at, updatedAt: at};
    }},
    authorization: {async authorizeWorkspaceOperation({requiredScopes}) {
      if (requiredScopes.includes("artifact:read") && !canRead) throw new Error("private policy detail");
    }},
    getUseCases() {assert.fail("No system use case is needed.");}, isOpen: () => true,
    async getIngestionTasks() { opens++; return {async executeCommand(command, context) {
      assert.deepEqual(command, {action: "read", taskId});
      assert.deepEqual(context, {workspaceId, organizationId, principalId});
      reads++; afterRead?.(); return {ok: true, value: {kind: "task", task}};
    }}; },
  });
  const source = request("data.ingestion-status", {hostIncarnationId, workspaceId, taskId});
  const described = await handler(request("host.describe", {}), async () => grant);
  assert.ok(described.ok && described.operation === "host.describe" && !described.value.operations.includes("data.ingestion-status"));
  const ready = await handler(request("host.describe", {}), async () => currentGrant);
  assert.ok(ready.ok && ready.operation === "host.describe" && ready.value.operations.includes("data.ingestion-status"));
  assert.equal(opens, 0);
  assert.deepEqual(await handler(source, async () => grant), forbidden);
  assert.equal(opens, 0);
  canRead = false;
  assert.deepEqual(await handler(source, async () => currentGrant), forbidden);
  assert.equal(opens, 0);
  canRead = true;
  assert.deepEqual(await handler(source, async () => currentGrant), {ok: true, operation: "data.ingestion-status",
    value: {taskId, state: "queued", sourceKind: "file-batch", revision: 1,
      progress: {completedItems: 0, totalItems: 1, acceptedBytes: 0, totalBytes: 4}}});
  afterRead = () => {currentGrant = grant;};
  assert.deepEqual(await handler(source, async () => currentGrant), forbidden);
  currentGrant = {...grant, planReview: true};
  afterRead = () => {canRead = false;};
  assert.deepEqual(await handler(source, async () => currentGrant), forbidden);
  afterRead = undefined; canRead = true;
  task = {...task, organizationId: createOrganizationId("foreign")};
  assert.deepEqual(await handler(source, async () => currentGrant), forbidden);
  task = {...task, organizationId, workspaceId: otherWorkspaceId};
  assert.deepEqual(await handler(source, async () => currentGrant), {ok: false, code: "headless.unavailable"});
  task = {...task, workspaceId};
  afterRead = () => {currentGrant = {...grant, planReview: true, isCurrent: () => false};};
  assert.deepEqual(await handler(source, async () => currentGrant), forbidden);
  assert.equal(reads, 6);
});

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

test("planning reports only operations allowed by the Desktop grant and current workspace policy", async () => {
  const authored: DesktopHeadlessReadGrant = {...grant, authoring:["systems.create", "systems.rename", "systems.apply-edits"]};
  let verified = authored;
  let narrowOnRead = false;
  let narrowEditOnRenameCheck = false;
  let canEdit = true;
  let trackFinalEditCheck = false;
  let finalEditChecked = false;
  const handler = composeDesktopHeadlessReads({
    hostIncarnationId, identity:{organizationId, principalId},
    workspaceRepository:{async readWorkspace(id) {
      return {workspaceId:id, organizationId, displayName:"Fixture", status:"active", createdAt:at, updatedAt:at};
    }},
    authorization:{async authorizeWorkspaceOperation({operation, requiredScopes}) {
      if (operation === "headless.systems.rename") {
        if (narrowEditOnRenameCheck) canEdit = false;
        throw new Error("Fixture denied rename.");
      }
      if (requiredScopes.includes("asset:write") && !canEdit) throw new Error("Fixture removed editing but kept reading.");
      if (trackFinalEditCheck && operation === "headless.plan.capabilities" && requiredScopes.includes("asset:write"))
        finalEditChecked = true;
      if (operation === "headless.systems.create") {
        assert.deepEqual(requiredScopes, ["workspace:read", "asset:read", "asset:write"]);
        if (narrowOnRead) verified = grant;
      }
    }},
    getUseCases() {throw new Error("Capability discovery does not invoke any system provider.");},
    isOpen:() => true,
  });
  const operation = "plan.capabilities";
  const target = request(operation, {hostIncarnationId, workspaceId});
  assert.deepEqual(await handler(target, async () => grant), {ok:true, operation, value:{workspaceId, actions:[], approval:"required"}});
  assert.deepEqual(await handler(target, async () => verified), {ok:true, operation,
    value:{workspaceId, actions:["systems.create"], approval:"required"}});
  const proposedOnly = { ...grant, planReview: true as const };
  assert.deepEqual(await handler(target, async () => proposedOnly), { ok: true, operation,
    value: { workspaceId, actions: ["systems.create", "systems.clone"], approval: "required" } });
  assert.deepEqual(await handler(request(operation, {hostIncarnationId, workspaceId:otherWorkspaceId}), async () => verified), forbidden);
  const described = await handler(request("host.describe", {}), async () => verified);
  assert.ok(described.ok && described.operation === "host.describe" && !described.value.operations.includes(operation));
  narrowOnRead = true;
  assert.deepEqual(await handler(target, async () => verified), forbidden);
  narrowOnRead = false;
  verified = proposedOnly;
  narrowOnRead = true;
  assert.deepEqual(await handler(target, async () => verified), forbidden);
  narrowOnRead = false;
  verified = authored;
  trackFinalEditCheck = true;
  let checkedGrantAfterEdit = false;
  const ordered = await handler(target, async () => {
    if (finalEditChecked) {
      checkedGrantAfterEdit = true;
      canEdit = false;
    }
    return authored;
  });
  assert.ok(ordered.ok && ordered.operation === "plan.capabilities" && ordered.value.actions.length === 1);
  assert.equal(finalEditChecked, true);
  assert.equal(checkedGrantAfterEdit, false);
  finalEditChecked = false;
  const retired = { ...authored, isCurrent: () => !finalEditChecked };
  assert.deepEqual(await handler(target, async () => retired), forbidden);
  trackFinalEditCheck = false;
  narrowEditOnRenameCheck = true;
  assert.deepEqual(await handler(target, async () => verified), forbidden);
  assert.deepEqual(await handler(target, async () => verified), {ok:true, operation,
    value:{workspaceId, actions:[], approval:"required"}});
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
