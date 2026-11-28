import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtemp, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {createInMemoryStructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {createStructuredOrganizationRepositories} from "../../../../adapters/persistence/organization";
import {createLocalWorkspaceRepository} from "../../../../adapters/persistence/workspace";
import {AuthorizeOperationService, createOrganizationAuthorizationPolicy} from "../../../../application/services/security";
import {createTenantPlacementConfig} from "../../../../contracts/config";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {HEADLESS_CONTRACT_VERSION, parseHeadlessReadRequest, type HeadlessReadRequest} from "../../../../contracts/headless";
import {composeServerHost} from "../composeServerHost";

test("Managed Root uses its original workflow/status readers and current membership without starting a model", {timeout: 30_000}, async () => {
  const parent = await realpath(tmpdir());
  const folder = await realpath(await mkdtemp(path.join(parent, "managed-workflow-root-")));
  const organizationId = createOrganizationId("managed-workflow-org"), workspaceId = createWorkspaceId("managed-workflow-workspace");
  const principalId = "managed-workflow-principal", timestamp = "2026-11-28T00:00:00.000Z";
  const documents = createInMemoryStructuredDocumentStore();
  const repositories = createStructuredOrganizationRepositories(documents);
  await repositories.organizations.saveOrganization({organizationId, displayName: "Synthetic", status: "active", createdAt: timestamp, updatedAt: timestamp});
  const membership = {organizationId, principalId, role: "operator" as const, status: "active" as const, createdAt: timestamp, updatedAt: timestamp};
  await repositories.memberships.saveMembership(membership);
  const organizationDocuments = documents.forOrganization(organizationId);
  const workspaces = createLocalWorkspaceRepository({documents: organizationDocuments, rootDirectory: folder});
  await workspaces.saveWorkspace({workspaceId, organizationId, displayName: "Synthetic", status: "active", createdAt: timestamp, updatedAt: timestamp});
  let context = {organizationId, principalId}, open = true, runtimeStarts = 0;
  const placement = createTenantPlacementConfig({mode: "dedicated", organizationId});
  const authorize = new AuthorizeOperationService(createOrganizationAuthorizationPolicy({...repositories, tenantPlacement: placement}),
    {createEventId: () => randomUUID(), now: () => timestamp});
  const host = composeServerHost({env: {NODE_ENV: "test", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1"},
    persistence: {documents, organizationDocuments},
    organizationContextProvider: {getCurrentOrganizationContext: () => context}, organizationAuthorizer: authorize,
    managedSavedState: {authorize, listActiveSystems: async () => []}, managedHeadlessAgent: {placement},
    pythonRuntimeEnvironmentPreparer: async () => {runtimeStarts++; throw new Error("Metadata must not prepare a runtime.");},
    settings: {localSettingsFilePath: path.join(folder, "settings.json")},
    artifactRepo: {providerCredentialRootDirectory: path.join(folder, "credentials"), huggingFaceTokenConfigFilePath: path.join(folder, "no-token.json")},
    logSink() {}, now: () => timestamp,
  });
  try {
    host.registerApi({app: {get() {}, post() {}, patch() {}, delete() {}}, storageRootDirectory: folder,
      runtimeRootDirectory: path.join(folder, "runtime")});
    await host.waitForAssetFoundation();
    const agent = host.getManagedHeadlessAgent(); assert.ok(agent); assert.equal(agent.workflowReads, true);
    const identity = {organizationId, principalId, purpose: "agent" as const, registeredClientId: randomUUID()};
    function request(operation: "host.describe" | "workflows.list" | "conversation-tasks.read"): HeadlessReadRequest {
      const parsed = parseHeadlessReadRequest({version: HEADLESS_CONTRACT_VERSION, operation, input: operation === "host.describe" ? {} : {
        hostIncarnationId: agent!.hostIncarnationId, workspaceId,
        ...(operation === "workflows.list" ? {sourceKind: "reviewed-execution-plan"} : {sessionId: "session.missing", turnId: "turn.missing"}),
      }}, agent!.hostIncarnationId);
      assert.ok(parsed.ok); if (!parsed.ok) throw new Error("Invalid fixture request."); return parsed.request;
    }
    const discovery = await agent.read(request("host.describe"), identity, () => open);
    assert.ok(discovery.ok && discovery.operation === "host.describe");
    for (const operation of ["workflows.list", "workflows.prepare", "conversation-tasks.read"])
      assert.ok(discovery.value.operations.includes(operation as "workflows.list"));
    assert.deepEqual(await agent.read(request("workflows.list"), identity, () => open), {ok: true, operation: "workflows.list", value: []});
    assert.deepEqual(await agent.read(request("conversation-tasks.read"), identity, () => open), {ok: false, code: "headless.not-found"});
    assert.deepEqual(await agent.read(request("workflows.list"), {...identity, purpose: "plan-review"}, () => open), {ok: false, code: "headless.forbidden"});
    await repositories.memberships.saveMembership({...membership, status: "suspended"});
    assert.deepEqual(await agent.read(request("workflows.list"), identity, () => open), {ok: false, code: "headless.forbidden"});
    await repositories.memberships.saveMembership(membership);
    context = {...context, principalId: "other-principal"};
    assert.deepEqual(await agent.read(request("conversation-tasks.read"), identity, () => open), {ok: false, code: "headless.forbidden"});
    context = {organizationId, principalId}; open = false;
    assert.deepEqual(await agent.read(request("workflows.list"), identity, () => open), {ok: false, code: "headless.forbidden"});
    open = true;
    await host.shutdownBackgroundTasks();
    assert.equal((await agent.read(request("workflows.list"), identity, () => open)).ok, false);
    assert.equal((await agent.read(request("conversation-tasks.read"), identity, () => open)).ok, false);
    assert.equal(runtimeStarts, 0);
  } finally {
    await host.closeRuntimeDatabases();
    const target = await realpath(folder);
    assert.equal(target, folder); assert.equal(path.dirname(target), parent);
    await rm(target, {recursive: true, force: true});
  }
});
