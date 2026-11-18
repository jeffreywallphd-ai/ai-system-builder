import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";

import {HEADLESS_CONTRACT_VERSION, type HeadlessHostIncarnationId} from "../../../../contracts/headless";
import {createOrganizationId} from "../../../../contracts/organization";
import {systemBuilderSuccess, normalizeSystemBuilderSystemId, normalizeSystemBuilderTemplateId} from "../../../../contracts/system-builder";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {normalizeIngestionTaskId, normalizeIngestionTaskFileId, normalizeIngestionSourceSnapshotId, normalizeIngestionSha256Digest, type IngestionTaskRecord} from "../../../../contracts/ingestion";
import {composeManagedAgentReads} from "../composeManagedAgentReads";
import {fixture as datasetFixture, workspaceId as dataWorkspaceId, organizationId as dataOrganizationId,
  principalId as dataPrincipalId, createdAt as dataAt} from "../../../../application/use-cases/dataset-version/tests/headless-dataset-metadata.fixture";
import {normalizeDatasetId, normalizeDatasetVersionId} from "../../../../contracts/dataset";

test("Managed preparation preview releases only matching public metadata for current planning clients", async () => {
  const hostIncarnationId = randomUUID() as HeadlessHostIncarnationId;
  const organizationId = createOrganizationId("preview-fixture-org"), workspaceId = createWorkspaceId("preview-fixture-workspace");
  const identity = {organizationId, principalId: "preview-fixture-principal"};
  const planner = {...identity, purpose: "plan-review" as const};
  const source = {taskId: normalizeIngestionTaskId("task.preview"), fileId: normalizeIngestionTaskFileId("file.preview"), taskRevision: 3};
  const target = {hostIncarnationId, workspaceId, sources: [source],
    recipe: {kind: "provided-instruction-rows-v1" as const, inputColumn: "question", outputColumn: "answer"},
    split: {trainRatio: 0.8, validationRatio: 0.1, testRatio: 0.1, seed: 42}, qualityPreset: "recommended" as const};
  const preview = {workspaceId, sources: [{...source, sourceSnapshotId: normalizeIngestionSourceSnapshotId("snapshot.preview"),
    format: "csv" as const, sizeBytes: 32, digest: normalizeIngestionSha256Digest("sha256:" + "a".repeat(64)), licenseStatus: "unknown" as const}],
    recipe: target.recipe, split: target.split, qualityPreset: target.qualityPreset, totalBytes: 32,
    maximumRowsPerSource: 1000 as const, outputFormat: "jsonl" as const, reviewRequired: true as const, externalProviderCalls: 0 as const, modelCalls: 0 as const};
  let live = true, allowed = true, altered = false, opens = 0;
  let afterRead: (() => void) | undefined;
  const at = "2026-11-17T00:00:00.000Z";
  const read = composeManagedAgentReads({hostIncarnationId, contexts: {getCurrentOrganizationContext: () => identity},
    workspaces: {async readWorkspace(id) {return {workspaceId: id, organizationId, displayName: "Fixture", status: "active", createdAt: at, updatedAt: at};}},
    authorization: {async authorizeWorkspaceOperation({requiredScopes}) {
      assert.deepEqual(requiredScopes, ["workspace:read", "artifact:read"]);
      if (!allowed) throw new Error("Synthetic denied");
    }},
    systems: {read: {async execute() {assert.fail();}}, listTemplates: {async execute() {assert.fail();}}},
    async getDatasetInputs() {opens++; return {async execute(input, authority) {
      assert.deepEqual(input, {version: HEADLESS_CONTRACT_VERSION, operation: "data.preview-dataset-preparation", input: target});
      assert.deepEqual(authority.context, {...identity, workspaceId});
      assert.equal(authority.hostIncarnationId, hostIncarnationId);
      if (!await authority.stillAllowed()) return {ok: false, code: "headless.forbidden" as const};
      afterRead?.();
      return {ok: true, prepared: {command: {sourceArtifactIds: ["private-source"]} as never,
        preview: {...preview, ...(altered ? {privateCommand: "private-source"} : {})}}} as const;
    }};},
  });
  const query = {version: HEADLESS_CONTRACT_VERSION, operation: "data.preview-dataset-preparation" as const, input: target};
  await read({version: HEADLESS_CONTRACT_VERSION, operation: "host.describe", input: {}}, planner, () => live);
  assert.equal(opens, 0);
  const denied = {ok: false, code: "headless.forbidden"};
  assert.deepEqual(await read(query, identity, () => live), denied);
  allowed = false; assert.deepEqual(await read(query, planner, () => live), denied);
  assert.equal(opens, 0); allowed = true;
  assert.deepEqual(await read(query, planner, () => live), {ok: true, operation: query.operation, value: preview});
  altered = true;
  assert.deepEqual(await read(query, planner, () => live), {ok: false, code: "headless.unavailable"});
  altered = false; afterRead = () => {live = false;};
  assert.deepEqual(await read(query, planner, () => live), denied);
});

test("Managed dataset queries keep tenant context and planner artifact permission current through reply", async () => {
  const hostIncarnationId = randomUUID() as HeadlessHostIncarnationId;
  const {queries} = await datasetFixture(2);
  const identity = {principalId: dataPrincipalId, organizationId: dataOrganizationId};
  const planner = {...identity, purpose: "plan-review" as const};
  let live = true, allowed = true, opens = 0;
  let afterRead: (() => void) | undefined;
  const read = composeManagedAgentReads({hostIncarnationId, contexts: {getCurrentOrganizationContext: () => identity},
    workspaces: {async readWorkspace(id) {return id === dataWorkspaceId ? {workspaceId: id, organizationId: dataOrganizationId,
      displayName: "Fixture", status: "active", createdAt: dataAt, updatedAt: dataAt} : undefined;}},
    authorization: {async authorizeWorkspaceOperation({requiredScopes}) {
      assert.deepEqual(requiredScopes, ["workspace:read", "artifact:read"]);
      if (!allowed) throw new Error("Synthetic denied");
    }},
    systems: {read: {async execute() {assert.fail();}}, listTemplates: {async execute() {assert.fail();}}},
    async getDatasetQueries() {opens++; return {async execute(input, authority) {
      const result = await queries.execute(input, authority); afterRead?.(); return result;
    }};},
  });
  const version = HEADLESS_CONTRACT_VERSION;
  const scope = {hostIncarnationId, workspaceId: dataWorkspaceId};
  const requests = [
    {version, operation: "data.dataset-versions" as const, input: {...scope, datasetId: normalizeDatasetId("dataset.synthetic"), versionIds: [normalizeDatasetVersionId("version.001")]}},
    {version, operation: "data.compare-dataset-versions" as const, input: {...scope,
      fromVersionId: normalizeDatasetVersionId("version.001"), toVersionId: normalizeDatasetVersionId("version.002")}},
  ];
  const denied = {ok: false, code: "headless.forbidden"};
  const description = await read({version, operation: "host.describe", input: {}}, planner, () => live);
  assert.ok(description.ok && description.operation === "host.describe" && description.value.operations.includes("data.dataset-versions"));
  assert.equal(opens, 0);
  for (const request of requests) {
    assert.deepEqual(await read(request, identity, () => live), denied);
    allowed = false;
    const initial = opens;
    assert.deepEqual(await read(request, planner, () => live), denied);
    assert.equal(opens, initial);
    allowed = true;
    const result = await read(request, planner, () => live);
    assert.ok(result.ok && result.operation === request.operation);
    afterRead = () => {live = false;};
    assert.deepEqual(await read(request, planner, () => live), denied);
    live = true; afterRead = () => {allowed = false;};
    assert.deepEqual(await read(request, planner, () => live), denied);
    allowed = true; afterRead = undefined;
  }
});

test("Managed Data reads require the planner registration and current tenant artifact permission", async () => {
  const hostIncarnationId = randomUUID() as HeadlessHostIncarnationId;
  const organizationId = createOrganizationId("fixture-org");
  const workspaceId = createWorkspaceId("fixture-workspace");
  const taskId = normalizeIngestionTaskId("intake.synthetic");
  const identity = {organizationId, principalId: "fixture-principal"};
  const planner = {...identity, purpose: "plan-review" as const};
  const at = "2026-11-17T00:00:00Z";
  let current = true;
  let allowed = true;
  let afterRead: (() => void) | undefined;
  let calls = 0;
  let task: IngestionTaskRecord = {schemaVersion: "1.0", organizationId, workspaceId, taskId,
    kind: "file-batch", status: "queued", revision: 1, cleanupPending: false, createdAt: at, updatedAt: at,
    files: [{fileId: normalizeIngestionTaskFileId("file.synthetic"), checkpointId: "private-checkpoint",
      fileName: "private-name.txt", mediaType: "text/plain", totalBytes: 4, status: "pending", acceptedBytes: 0, nextChunkIndex: 0}],
    progress: {completedItems: 0, totalItems: 1, acceptedBytes: 0, totalBytes: 4, percent: 0, message: "private-message"}};
  const read = composeManagedAgentReads({hostIncarnationId,
    contexts: {getCurrentOrganizationContext: () => identity},
    workspaces: {async readWorkspace(id) {return {workspaceId: id, organizationId, displayName: "Fixture", status: "active", createdAt: at, updatedAt: at};}},
    authorization: {async authorizeWorkspaceOperation({requiredScopes}) {
      assert.deepEqual(requiredScopes, ["workspace:read", "artifact:read"]);
      if (!allowed) throw new Error("private denial");
    }},
    systems: {read: {async execute() {assert.fail();}}, listTemplates: {async execute() {assert.fail();}}},
    ingestionTasks: {async executeCommand(command, context) {
      assert.deepEqual(command, {action: "read", taskId});
      assert.deepEqual(context, {...identity, workspaceId}); calls++; afterRead?.();
      return {ok: true, value: {kind: "task", task}};
    }},
  });
  const version = HEADLESS_CONTRACT_VERSION;
  const request = {version, operation: "data.ingestion-status" as const, input: {hostIncarnationId, workspaceId, taskId}};
  const denied = {ok: false, code: "headless.forbidden"};
  const described = await read({version, operation: "host.describe", input: {}}, identity, () => current);
  assert.ok(described.ok && described.operation === "host.describe" && !described.value.operations.includes("data.ingestion-status"));
  assert.equal(calls, 0);
  assert.deepEqual(await read(request, identity, () => current), denied);
  allowed = false;
  assert.deepEqual(await read(request, planner, () => current), denied);
  assert.equal(calls, 0);
  allowed = true;
  assert.deepEqual(await read(request, planner, () => current), {ok: true, operation: "data.ingestion-status",
    value: {taskId, state: "queued", sourceKind: "file-batch", revision: 1,
      progress: {completedItems: 0, totalItems: 1, acceptedBytes: 0, totalBytes: 4}}});
  afterRead = () => {current = false;};
  assert.deepEqual(await read(request, planner, () => current), denied);
  current = true; afterRead = () => {allowed = false;};
  assert.deepEqual(await read(request, planner, () => current), denied);
  allowed = true; afterRead = undefined;
  task = {...task, organizationId: createOrganizationId("foreign")};
  assert.deepEqual(await read(request, planner, () => current), denied);
  assert.equal(calls, 4);
});

test("managed discovery and saved reads remain scoped to the same host, principal and workspace", async () => {
  const hostIncarnationId = randomUUID() as HeadlessHostIncarnationId;
  const organizationId = createOrganizationId("fixture-org");
  const principalId = "fixture-principal";
  const workspaceId = createWorkspaceId("fixture-workspace");
  const systemId = normalizeSystemBuilderSystemId("fixture.system");
  const identity = {organizationId, principalId};
  const at = new Date(0).toISOString();
  const templateId = normalizeSystemBuilderTemplateId("reference.secured-data-review@1.0.0");
  let current = true;
  let applies = 0;
  let workspaceReads = 0;
  let held = false;
  let deniedAction: string | undefined;
  let deniedScopes: readonly string[] | undefined;
  let narrowOnActionDenial = false;
  let canEdit = true;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const read = composeManagedAgentReads({ hostIncarnationId,
    contexts: {getCurrentOrganizationContext: () => identity},
    workspaces: {async readWorkspace(target) {
      workspaceReads++;
      if (target === workspaceId) return {workspaceId, organizationId, status: "active", displayName: "Fixture", createdAt: at, updatedAt: at};
    }},
    authorization: {async authorizeWorkspaceOperation({operation, requiredScopes}) {
      applies++;
      if (operation === deniedAction) {
        deniedScopes = requiredScopes;
        if (narrowOnActionDenial) canEdit = false;
        throw new Error("Fixture denied the requested action.");
      }
      if (requiredScopes.includes("asset:write") && !canEdit) throw new Error("Fixture removed editing but kept reading.");
    }},
    systems: {
      read: {async execute() {
        entered.resolve();
        if (held) await release.promise;
        return systemBuilderSuccess({systemId, targetWorkspaceId: workspaceId, status: "draft", revision: 1,
          name: "Fixture", createdAt: at, updatedAt: at, createdBy: principalId, updatedBy: principalId});
      }},
      listTemplates: {async execute() { return [{templateId, displayName: "Synthetic reference template"}]; }},
    },
  });
  const live = () => current;
  const version = HEADLESS_CONTRACT_VERSION;
  const description = await read({version, operation: "host.describe", input: {}}, identity, live);
  assert.ok(description.ok && description.operation === "host.describe" && description.value.hostIncarnationId === hostIncarnationId);
  assert.deepEqual(description.value.workspaces, []);
  assert.equal(workspaceReads, 0);
  const request = {version, operation: "templates.list" as const, input: {hostIncarnationId, workspaceId}};
  assert.deepEqual(await read(request, identity, live), {ok: true, operation: "templates.list",
    value: [{templateId, displayName: "Synthetic reference template"}]});
  assert.equal(applies, 2);
  assert.deepEqual(await read({...request, input: {...request.input, workspaceId: createWorkspaceId("foreign-workspace")}}, identity, live),
    {ok: false, code: "headless.forbidden"});
  assert.deepEqual(await read(request, {...identity, principalId: "different"}, live), {ok: false, code: "headless.forbidden"});
  const capabilities = {...request, operation:"plan.capabilities" as const};
  deniedAction = "headless.systems.rename";
  assert.deepEqual(await read(capabilities, identity, live), {ok:true, operation:"plan.capabilities",
    value:{workspaceId, actions:["systems.create", "systems.clone"], approval:"required"}});
  assert.deepEqual(deniedScopes, ["workspace:read", "asset:read", "asset:write"]);
  assert.deepEqual(await read({...capabilities, input:{...request.input, workspaceId:createWorkspaceId("other-workspace")}}, identity, live),
    {ok:false, code:"headless.forbidden"});
  assert.deepEqual(await read({...capabilities, input:{...request.input, hostIncarnationId:randomUUID() as HeadlessHostIncarnationId}}, identity, live),
    {ok:false, code:"headless.host-changed"});
  narrowOnActionDenial = true;
  assert.deepEqual(await read(capabilities, identity, live), {ok:false, code:"headless.forbidden"});
  assert.deepEqual(await read(capabilities, identity, live), {ok:true, operation:"plan.capabilities",
    value:{workspaceId, actions:[], approval:"required"}});
  held = true;
  const pending = read({version, operation: "systems.read", input: {hostIncarnationId, workspaceId, systemId}}, identity, live);
  await entered.promise;
  current = false;
  release.resolve();
  assert.deepEqual(await pending, {ok: false, code: "headless.forbidden"});
});

test("Managed query task publication rechecks ModelRead after the task result returns", async () => {
  let modelAllowed = true, modelChecks = 0, opens = 0;
  const organizationId = createOrganizationId("org.synthetic"), workspaceId = createWorkspaceId("workspace.synthetic"), principalId = "principal.synthetic";
  const hostIncarnationId = "a1242a53-b265-4338-a2e2-bc24b65cd381" as HeadlessHostIncarnationId, taskId = randomUUID();
  const at = "2026-11-18T00:00:00.000Z";
  const read = composeManagedAgentReads({hostIncarnationId, contexts: {getCurrentOrganizationContext: () => ({organizationId, principalId})},
    workspaces: {async readWorkspace() {return {workspaceId, organizationId, status: "active", displayName: "Synthetic", createdAt: at, updatedAt: at};}},
    authorization: {async authorizeWorkspaceOperation({requiredScopes}) {
      if (requiredScopes.includes("model:read")) {modelChecks++; if (!modelAllowed) throw new Error("Model access ended.");}
    }}, systems: {listTemplates() {assert.fail("No System Builder access.");}, read() {assert.fail("No System Builder access.");}},
    async getContextTask() {return {async execute(_request, authority) {
      opens++; assert.equal(await authority.queryStillAllowed?.(), true);
      modelAllowed = false;
      return {ok: true, operation: "context.task", value: {taskId, state: "succeeded", review: null,
        query: {queryDigest: "sha256:" + "a".repeat(64), maximumResults: 1, embeddingDevice: "cpu", cleanupPending: false,
          sources: [{reference: {kind: "ingestion-file", taskId: "task.one", fileId: "file.one", taskRevision: 1}, digest: "sha256:" + "b".repeat(64)}], matches: []}}} as never;
    }};},
  });
  const value = await read({version: HEADLESS_CONTRACT_VERSION, operation: "context.task", input: {hostIncarnationId, workspaceId,
    selection: {kind: "task", taskId}}}, {organizationId, principalId, registeredClientId: taskId, purpose: "plan-review", isCurrent: () => true}, () => true);
  assert.deepEqual(value, {ok: false, code: "headless.forbidden"}); assert.equal(opens, 1); assert.equal(modelChecks, 2);
});
