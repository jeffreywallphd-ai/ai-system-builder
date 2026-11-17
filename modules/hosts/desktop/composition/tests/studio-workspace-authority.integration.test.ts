import { createOrganizationId } from "../../../../contracts/organization";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { composeDesktopHost } from "../composeDesktopHost";
import { composeServerHost } from "../../../server/composition/composeServerHost";
import { createInMemoryStructuredDocumentStore, createOrganizationContextStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createLocalWorkspaceRepository } from "../../../../adapters/persistence/workspace";
import { initializeLocalIdentityProfile } from "../../../../adapters/security/local-identity";
import { createStructuredOrganizationRepositories } from "../../../../adapters/persistence/organization";
import { AuthorizeOperationService, createOrganizationAuthorizationPolicy } from "../../../../application/services/security";
import { createTenantPlacementConfig } from "../../../../contracts/config";
import { DESKTOP_ASSET_STUDIO_CHANNELS } from "../../../../contracts/ipc";
import { setExpressAuthContext } from "../../../../adapters/transport/api-express/security/expressAuthContext";

test("Studio desktop and server requests use current workspace access and preserve denied state", {timeout: 30_000}, async () => {
  for (const kind of ["desktop", "server"] as const) {
    const ownedRoot = await mkdtemp(join(tmpdir(), "studio-authority-"));
    const exactRoot = await realpath(ownedRoot);
    let shutdown: (() => Promise<void>) | undefined;
    try {
      const documents = createInMemoryStructuredDocumentStore();
      let sequence = 0;
      const at = "2026-10-22T00:00:00.000Z";
      const identity = await initializeLocalIdentityProfile({ documents, organizationDisplayName: "Fixture", principalDisplayName: "Fixture", now: () => at, createId: () => `host-assets.${++sequence}` });
      const contexts = { getCurrentOrganizationContext: () => ({organizationId: identity.organizationId, principalId: identity.principalId}) };
      const organizationDocuments = kind === "server" ? createOrganizationContextStructuredDocumentStore(documents, contexts) : documents.forOrganization(identity.organizationId);
      const workspaces = createLocalWorkspaceRepository({rootDirectory: ownedRoot, documents: organizationDocuments});
      const workspace: any = {workspaceId: "workspace.allowed", organizationId: identity.organizationId, status: "active", displayName: "Fixture", createdAt: at, updatedAt: at};
      await workspaces.saveWorkspace(workspace);
      await workspaces.saveWorkspace({...workspace, workspaceId: "workspace.archived", status: "archived"});
      const foreignOrg = createOrganizationId("assets.foreign-fixture");
      await createLocalWorkspaceRepository({rootDirectory: ownedRoot, documents: documents.forOrganization(foreignOrg)}).saveWorkspace({...workspace, workspaceId: "workspace.foreign", organizationId: foreignOrg});
      const operations = ["start", "propose", "review", "read", "list", "createAssetDraft", "updateAssetDraft", "readAssetDraft", "listAssetDrafts", "reviewAssetDraft", "publishAssetDraft", "abandonAssetDraft"] as const;
      type Operation = typeof operations[number];
      const definitionRef = {kind: "asset-definition-version", id: "asset.host-studio", version: "1.0.0"};
      const payload = (operation: Operation, workspaceId: string, extra: any = {}) => ({workspaceId, definitionRef, displayName: "Original", workflowId: "workflow.absent", implementationDraftId: "implementation.absent", draftId: "draft.absent", expectedRevision: 1, decision: "reject", approvedDependencies: [], approvedCapabilities: [], mode: "manual", intent: "Add a useful view", context: [], allowedDependencies: [], allowedCapabilities: [], manualProposal: {summary: "View", plan: ["Add view"], files: [{path: "src/view.ts", content: "export const view = true;"}], dependencies: [], requestedCapabilities: []},
        semanticDefinition: {assetType: "tool", assetFamily: "behavioral", displayName: "Original", description: "A complete resource-backed Studio test tool.", aiContext: {purpose: "Exercise Studio", userFacingSummary: "A test tool", developerFacingSummary: "A deterministic fixture", capabilities: [{summary: "test"}], limitations: [{summary: "Fixture"}]}}, resources: [{path: "backend/logic.ts", role: "backend-logic", mediaType: "text/typescript", content: "export const value = 1;"}], ...extra});
      let run: (operation: Operation, workspaceId: string, extra?: any) => Promise<any>;
      let desktop: ReturnType<typeof composeDesktopHost> | undefined;
      const logs: any[] = [];
      if (kind === "desktop") {
        const handlers = new Map<string, any>();
        const host = composeDesktopHost({persistence: {documents, organizationDocuments}, localIdentity: identity, now: () => at, logSink: entry => {logs.push(entry);}});
        desktop = host;
        host.registerDesktopIpc({ipcMain: {handle(channel, handler) {handlers.set(channel, handler);}}, senderTrust: {isTrustedSender: () => true}, storageRootDirectory: ownedRoot, runtimeRootDirectory: join(ownedRoot, "runtime")});
        run = (operation, owner, extra) => handlers.get(DESKTOP_ASSET_STUDIO_CHANNELS[operation].request.value)({}, {payload: payload(operation, owner, extra)});
      } else {
        const routes = new Map<string, any>();
        const register = (method: string) => (path: string, ...handlers: any[]) => {routes.set(`${method}:${path}`, handlers[handlers.length - 1]);};
        const app: any = {get: register("get"), post: register("post"), patch: register("patch"), put: register("put"), delete: register("delete"), use() {}};
        const repositories = createStructuredOrganizationRepositories(documents);
        const authorizer = new AuthorizeOperationService(createOrganizationAuthorizationPolicy({organizations: repositories.organizations, memberships: repositories.memberships, tenantPlacement: createTenantPlacementConfig({mode: "dedicated", organizationId: identity.organizationId})}));
        const host = composeServerHost({persistence: {documents, organizationDocuments}, organizationContextProvider: contexts, organizationAuthorizer: authorizer, now: () => at, env: {NODE_ENV: "test"}, logSink: () => undefined});
        host.registerApi({app, storageRootDirectory: ownedRoot, runtimeRootDirectory: join(ownedRoot, "runtime")});
        shutdown = async () => {await host.shutdownBackgroundTasks(); await host.closeRuntimeDatabases();};
        await host.waitForAssetFoundation();
        const invoke = async (method: string, path: string, payload: any, params?: any) => {
          const req: any = method !== "get" ? {body: payload} : {query: payload};
          req.params = params;
          setExpressAuthContext(req, {authenticated: true, authMethod: "external", principal: {principalId: identity.principalId, kind: "user", roles: [], scopes: []}});
          const res: any = {body: undefined, status() {return this;}, json(value: any) {this.body = value; return this;}};
          assert.ok(routes.has(`${method}:${path}`));
          await routes.get(`${method}:${path}`)(req, res);
          return res.body;
        };
        const urls: Record<Operation, [string, string]> = {start: ["post", "/start"], propose: ["post", "/propose"], review: ["post", "/review"], read: ["get", "/proposal"], list: ["get", "/workflows"], createAssetDraft: ["post", "/asset-drafts"], updateAssetDraft: ["post", "/asset-drafts/update"], readAssetDraft: ["get", "/asset-draft"], listAssetDrafts: ["get", "/asset-drafts"], reviewAssetDraft: ["post", "/asset-drafts/review"], publishAssetDraft: ["post", "/asset-drafts/publish"], abandonAssetDraft: ["post", "/asset-drafts/abandon"]};
        run = (operation, owner, extra) => invoke(urls[operation][0], "/api/asset-studio"+urls[operation][1], payload(operation, owner, extra));
      }
      const namespaces = ["asset-studio/asset-drafts", "asset-studio/workflows", "asset-implementation/drafts"];
      const snapshot = async () => Promise.all(namespaces.map(namespace => organizationDocuments.listDocuments(namespace)));
      const initial = await snapshot();
      for (const owner of ["workspace.absent", "workspace.archived", "workspace.foreign"]) {
        for (const operation of operations) assert.equal((await run(operation, owner)).ok, false, `${kind} ${owner} ${operation}`);
      }
      assert.deepEqual(await snapshot(), initial);
      if (desktop) {
        assert.equal(desktop.getInternalAssetRegistry(), undefined);
        assert.ok(desktop.getFeatureLifecycleState().every(feature => !feature.loaded));
        assert.ok(!logs.some(entry => entry.event === "desktop.host.feature.load.failed"));
      }
      const original = payload("createAssetDraft", workspace.workspaceId);
      const creating = run("createAssetDraft", workspace.workspaceId, original);
      original.semanticDefinition.displayName = "Changed";
      original.resources[0].content = "Changed";
      const created = await creating;
      assert.equal(created.ok, true, `${kind} ${JSON.stringify(created)}`);
      assert.equal(created.value.semanticDefinition.displayName, "Original");
      const draftId = created.value.draftId;
      const opened = await run("readAssetDraft", workspace.workspaceId, {draftId});
      assert.equal(opened.ok, true, JSON.stringify(opened));
      assert.equal(opened.value.resources[0].content, "export const value = 1;");
      const updated = await run("updateAssetDraft", workspace.workspaceId, {draftId, expectedRevision: 1});
      assert.equal(updated.ok, true, JSON.stringify(updated));
      const reviewed = await run("reviewAssetDraft", workspace.workspaceId, {draftId, expectedRevision: 2});
      assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
      const published = await run("publishAssetDraft", workspace.workspaceId, {draftId, expectedRevision: 3});
      assert.equal(published.ok, true, JSON.stringify(published));
      const started = await run("start", workspace.workspaceId);
      assert.equal(started.ok, true, JSON.stringify(started));
      assert.equal((await run("list", workspace.workspaceId)).ok, true);
      const preserved = await snapshot();
      if (desktop) assert.ok(desktop.getFeatureLifecycleState().some(feature => feature.featureKey === "asset-registry" && feature.loaded));
      const memberships = createStructuredOrganizationRepositories(documents).memberships;
      const membership = await memberships.readMembership({organizationId: identity.organizationId, principalId: identity.principalId});
      assert.ok(membership);
      await memberships.saveMembership({...membership, status: "suspended", updatedAt: at});
      for (const operation of operations) assert.equal((await run(operation, workspace.workspaceId)).ok, false, `${kind} suspended ${operation}`);
      assert.deepEqual(await snapshot(), preserved);
    } finally {
      await shutdown?.();
      assert.equal(await realpath(ownedRoot), exactRoot);
      assert.equal(resolve(ownedRoot), exactRoot);
      await rm(ownedRoot, {recursive: true, force: true});
    }
  }
});
