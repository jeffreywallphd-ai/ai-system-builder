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
import { DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_READ_DRAFT_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_REQUEST_CHANNEL, DESKTOP_ASSET_PACKAGE_CHANNELS, DESKTOP_ASSET_STUDIO_CHANNELS } from "../../../../contracts/ipc";
import { setExpressAuthContext } from "../../../../adapters/transport/api-express/security/expressAuthContext";

test("actual desktop and server compositions bind persisted workspace and membership authority", async () => {
  for (const kind of ["desktop", "server"] as const) {
    const ownedRoot = await mkdtemp(join(tmpdir(), "assets-workspace-"));
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
      const command = (workspaceId: string) => ({workspaceId, definitionRef: {kind: "asset-definition-version", id: "asset.synthetic", version: "1.0.0"}, displayName: "Synthetic draft"});
      let start: (workspaceId: string) => Promise<any>;
      let legacyCreate: (workspaceId: string) => Promise<any>;
      let legacyRead: (workspaceId: string, draftId: string) => Promise<any>;
      let legacyUpdate: (workspaceId: string, draftId: string) => Promise<any>;
      let listPackages: (workspaceId: string) => Promise<any>;
      if (kind === "desktop") {
        const handlers = new Map<string, any>();
        const host = composeDesktopHost({persistence: {documents, organizationDocuments}, localIdentity: identity, now: () => at, logSink: () => undefined});
        host.registerDesktopIpc({ipcMain: {handle(channel, handler) {handlers.set(channel, handler);}}, senderTrust: {isTrustedSender: () => true}, storageRootDirectory: ownedRoot, runtimeRootDirectory: join(ownedRoot, "runtime")});
        start = workspaceId => handlers.get(DESKTOP_ASSET_STUDIO_CHANNELS.start.request.value)({}, {payload: command(workspaceId)});
        listPackages = workspaceId => handlers.get(DESKTOP_ASSET_PACKAGE_CHANNELS.list.request.value)({}, {payload: {workspaceId}});
        legacyCreate = targetWorkspaceId => handlers.get(DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_REQUEST_CHANNEL.value)({}, {payload: {targetWorkspaceId, draftEditableValues: {"display-name": "Legacy fixture"}}});
        legacyRead = (targetWorkspaceId, draftId) => handlers.get(DESKTOP_ASSET_AUTHORING_READ_DRAFT_REQUEST_CHANNEL.value)({}, {payload: {targetWorkspaceId, draftId}});
        legacyUpdate = (targetWorkspaceId, draftId) => handlers.get(DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_REQUEST_CHANNEL.value)({}, {payload: {targetWorkspaceId, draftId, draftEditablePatch: {summary: "Updated"}}});
      } else {
        const routes = new Map<string, any>();
        const register = (method: string) => (path: string, ...handlers: any[]) => {routes.set(`${method}:${path}`, handlers.at(-1));};
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
        start = workspaceId => invoke("post", "/api/asset-studio/start", command(workspaceId));
        listPackages = workspaceId => invoke("get", "/api/asset-packages", {workspaceId});
        legacyCreate = workspaceId => invoke("post", "/api/asset-authoring/workspaces/:workspaceId/drafts", {targetWorkspaceId: workspaceId, draftEditableValues: {"display-name": "Legacy fixture"}}, {workspaceId});
        legacyRead = (workspaceId, draftId) => invoke("get", "/api/asset-authoring/workspaces/:workspaceId/drafts/:draftId", {}, {workspaceId, draftId});
        legacyUpdate = (workspaceId, draftId) => invoke("patch", "/api/asset-authoring/workspaces/:workspaceId/drafts/:draftId", {targetWorkspaceId: workspaceId, draftId, draftEditablePatch: {summary: "Updated"}}, {workspaceId, draftId});
      }
      for (const workspaceId of ["workspace.absent", "workspace.archived", "workspace.foreign"]) {
        assert.equal((await legacyCreate(workspaceId)).ok, false);
        assert.equal((await legacyRead(workspaceId, "draft.absent")).ok, false);
        assert.equal((await start(workspaceId)).ok, false, `${kind} start ${workspaceId}`);
        assert.equal((await listPackages(workspaceId)).ok, false, `${kind} list ${workspaceId}`);
      }
      assert.equal((await organizationDocuments.listDocuments("asset-implementation/drafts")).length, 0);
      const accepted = await start(workspace.workspaceId);
      assert.equal(accepted.ok, true, JSON.stringify(accepted));
      assert.equal((await listPackages(workspace.workspaceId)).ok, true);
      assert.equal((await organizationDocuments.listDocuments("asset-implementation/drafts")).length, 1);
      const legacy = await legacyCreate(workspace.workspaceId);
      assert.equal(legacy.ok, true, JSON.stringify(legacy));
      assert.equal((await legacyRead(workspace.workspaceId, legacy.value.draftId)).ok, true);
      const updatedLegacy = await legacyUpdate(workspace.workspaceId, legacy.value.draftId);
      assert.equal(updatedLegacy.ok, true, `${kind} ${JSON.stringify(updatedLegacy)}`);
      const memberships = createStructuredOrganizationRepositories(documents).memberships;
      const membership = await memberships.readMembership({organizationId: identity.organizationId, principalId: identity.principalId});
      assert.ok(membership);
      await memberships.saveMembership({...membership, status: "suspended", updatedAt: at});
      assert.equal((await legacyCreate(workspace.workspaceId)).ok, false);
      assert.equal((await legacyRead(workspace.workspaceId, legacy.value.draftId)).ok, false);
      assert.equal((await legacyUpdate(workspace.workspaceId, legacy.value.draftId)).ok, false);
      assert.equal((await start(workspace.workspaceId)).ok, false);
      assert.equal((await listPackages(workspace.workspaceId)).ok, false);
      assert.equal((await organizationDocuments.listDocuments("asset-implementation/drafts")).length, 1);
    } finally {
      await shutdown?.();
      assert.equal(await realpath(ownedRoot), exactRoot);
      assert.equal(resolve(ownedRoot), exactRoot);
      await rm(ownedRoot, {recursive: true, force: true});
    }
  }
});
