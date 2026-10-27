import { createOrganizationId } from "../../../../contracts/organization";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { composeDesktopHost } from "../composeDesktopHost";
import { composeServerHost } from "../../../server/composition/composeServerHost";
import { createInMemoryStructuredDocumentStore, createOrganizationContextStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createLocalAssetDraftRepositoryAdapter } from "../../../../adapters/persistence/asset-authoring";
import { createLocalWorkspaceRepository } from "../../../../adapters/persistence/workspace";
import { initializeLocalIdentityProfile } from "../../../../adapters/security/local-identity";
import { createStructuredOrganizationRepositories } from "../../../../adapters/persistence/organization";
import { AuthorizeOperationService, createOrganizationAuthorizationPolicy } from "../../../../application/services/security";
import { createTenantPlacementConfig } from "../../../../contracts/config";
import { DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_READ_DRAFT_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_REQUEST_CHANNEL } from "../../../../contracts/ipc";
import { setExpressAuthContext } from "../../../../adapters/transport/api-express/security/expressAuthContext";

test("legacy desktop and server authoring uses persisted workspace and current membership authority", async () => {
  for (const kind of ["desktop", "server"] as const) {
    const ownedRoot = await mkdtemp(join(tmpdir(), "legacy-authority-"));
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
      let legacyCreate: (workspaceId: string) => Promise<any>;
      let legacyRead: (workspaceId: string, draftId: string) => Promise<any>;
      let legacyUpdate: (workspaceId: string, draftId: string) => Promise<any>;
      if (kind === "desktop") {
        const handlers = new Map<string, any>();
        const host = composeDesktopHost({persistence: {documents, organizationDocuments}, localIdentity: identity, now: () => at, logSink: () => undefined});
        host.registerDesktopIpc({ipcMain: {handle(channel, handler) {handlers.set(channel, handler);}}, senderTrust: {isTrustedSender: () => true}, storageRootDirectory: ownedRoot, runtimeRootDirectory: join(ownedRoot, "runtime")});
        legacyCreate = targetWorkspaceId => handlers.get(DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_REQUEST_CHANNEL.value)({}, {payload: {targetWorkspaceId, draftEditableValues: {"display-name": "Legacy fixture"}}});
        legacyRead = (targetWorkspaceId, draftId) => handlers.get(DESKTOP_ASSET_AUTHORING_READ_DRAFT_REQUEST_CHANNEL.value)({}, {payload: {targetWorkspaceId, draftId}});
        legacyUpdate = (targetWorkspaceId, draftId) => handlers.get(DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_REQUEST_CHANNEL.value)({}, {payload: {targetWorkspaceId, draftId, draftEditablePatch: {summary: "Updated"}}});
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
        legacyCreate = workspaceId => invoke("post", "/api/asset-authoring/workspaces/:workspaceId/drafts", {targetWorkspaceId: workspaceId, draftEditableValues: {"display-name": "Legacy fixture"}}, {workspaceId});
        legacyRead = (workspaceId, draftId) => invoke("get", "/api/asset-authoring/workspaces/:workspaceId/drafts/:draftId", {}, {workspaceId, draftId});
        legacyUpdate = (workspaceId, draftId) => invoke("patch", "/api/asset-authoring/workspaces/:workspaceId/drafts/:draftId", {targetWorkspaceId: workspaceId, draftId, draftEditablePatch: {summary: "Updated"}}, {workspaceId, draftId});
      }
      for (const workspaceId of ["workspace.absent", "workspace.archived", "workspace.foreign"]) {
        assert.equal((await legacyCreate(workspaceId)).ok, false);
        assert.equal((await legacyRead(workspaceId, "draft.absent")).ok, false);
      }
      const rawDrafts = createLocalAssetDraftRepositoryAdapter({rootDir: ownedRoot, documents: organizationDocuments, now: () => at});
      for (const deniedWorkspace of ["workspace.absent", "workspace.archived", "workspace.foreign"]) {
        assert.deepEqual((await rawDrafts.listAssetDraftRecords({workspaceId: deniedWorkspace as never})).records, []);
      }
      const legacy = await legacyCreate(workspace.workspaceId);
      assert.equal(legacy.ok, true, JSON.stringify(legacy));
      assert.equal((await legacyRead(workspace.workspaceId, legacy.value.draftId)).ok, true);
      const updatedLegacy = await legacyUpdate(workspace.workspaceId, legacy.value.draftId);
      assert.equal(updatedLegacy.ok, true, `${kind} ${JSON.stringify(updatedLegacy)}`);
      const preserved = await rawDrafts.readAssetDraftRecord(workspace.workspaceId, legacy.value.draftId);
      assert.deepEqual(preserved, updatedLegacy.value);
      assert.equal(preserved?.draftEditableValues.summary, "Updated");
      const memberships = createStructuredOrganizationRepositories(documents).memberships;
      const membership = await memberships.readMembership({organizationId: identity.organizationId, principalId: identity.principalId});
      assert.ok(membership);
      await memberships.saveMembership({...membership, status: "suspended", updatedAt: at});
      assert.equal((await legacyCreate(workspace.workspaceId)).ok, false);
      assert.equal((await legacyRead(workspace.workspaceId, legacy.value.draftId)).ok, false);
      assert.equal((await legacyUpdate(workspace.workspaceId, legacy.value.draftId)).ok, false);
      assert.deepEqual(await rawDrafts.readAssetDraftRecord(workspace.workspaceId, legacy.value.draftId), preserved);
      const remaining = await rawDrafts.listAssetDraftRecords({workspaceId: workspace.workspaceId});
      assert.equal(remaining.records.length, 1);
      assert.equal(remaining.records[0]?.draftId, legacy.value.draftId);
    } finally {
      await shutdown?.();
      assert.equal(await realpath(ownedRoot), exactRoot);
      assert.equal(resolve(ownedRoot), exactRoot);
      await rm(ownedRoot, {recursive: true, force: true});
    }
  }
});
