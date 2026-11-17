import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";

import {HEADLESS_CONTRACT_VERSION, type HeadlessHostIncarnationId} from "../../../../contracts/headless";
import {createOrganizationId} from "../../../../contracts/organization";
import {systemBuilderSuccess, normalizeSystemBuilderSystemId, normalizeSystemBuilderTemplateId} from "../../../../contracts/system-builder";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {composeManagedAgentReads} from "../composeManagedAgentReads";

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
