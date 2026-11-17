import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";

import {HEADLESS_CONTRACT_VERSION, type HeadlessHostIncarnationId} from "../../../../contracts/headless";
import {createOrganizationId} from "../../../../contracts/organization";
import {systemBuilderSuccess, normalizeSystemBuilderSystemId, normalizeSystemBuilderTemplateId} from "../../../../contracts/system-builder";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {normalizeIngestionTaskId, normalizeIngestionTaskFileId, type IngestionTaskRecord} from "../../../../contracts/ingestion";
import {composeManagedAgentReads} from "../composeManagedAgentReads";

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
