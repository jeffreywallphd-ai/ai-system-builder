import { createOrganizationId } from "../../../../contracts/organization";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { composeDesktopHost } from "../composeDesktopHost";
import { composeServerHost } from "../../../server/composition/composeServerHost";
import { createInMemoryStructuredDocumentStore, createOrganizationContextStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createPackageFixture } from "../../../../testing/fixtures/asset-package-fixture";
import { createLocalWorkspaceRepository } from "../../../../adapters/persistence/workspace";
import { initializeLocalIdentityProfile } from "../../../../adapters/security/local-identity";
import { createStructuredOrganizationRepositories } from "../../../../adapters/persistence/organization";
import { AuthorizeOperationService, createOrganizationAuthorizationPolicy } from "../../../../application/services/security";
import { createTenantPlacementConfig } from "../../../../contracts/config";
import { DESKTOP_ASSET_PACKAGE_CHANNELS } from "../../../../contracts/ipc";
import { setExpressAuthContext } from "../../../../adapters/transport/api-express/security/expressAuthContext";

test("package desktop and server requests use current workspace access and preserve denied state", async () => {
  for (const kind of ["desktop", "server"] as const) {
    const ownedRoot = await mkdtemp(join(tmpdir(), "package-authority-"));
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
      const fixture = await createPackageFixture();
      const operations = ["inspect", "admit", "activate", "disable", "rollback", "list"] as const;
      type Operation = typeof operations[number];
      const payload = (operation: Operation, workspaceId: string, bytes: Uint8Array = fixture.bytes) => ({workspaceId, ...(operation === "inspect" ? {bytes, contentBase64: Buffer.from(bytes).toString("base64")} : {}), inspectionId: "inspection.absent", packageDigest: `sha256:${"a".repeat(64)}`, approvalScope: "workspace", approvedCapabilities: [], recordId: "package.absent"});
      let run: (operation: Operation, workspaceId: string, bytes?: Uint8Array) => Promise<any>;
      let desktop: ReturnType<typeof composeDesktopHost> | undefined;
      const logs: any[] = [];
      if (kind === "desktop") {
        const handlers = new Map<string, any>();
        const host = composeDesktopHost({persistence: {documents, organizationDocuments}, localIdentity: identity, now: () => at, logSink: entry => {logs.push(entry);}});
        desktop = host;
        host.registerDesktopIpc({ipcMain: {handle(channel, handler) {handlers.set(channel, handler);}}, senderTrust: {isTrustedSender: () => true}, storageRootDirectory: ownedRoot, runtimeRootDirectory: join(ownedRoot, "runtime")});
        run = (operation, owner, bytes) => handlers.get(DESKTOP_ASSET_PACKAGE_CHANNELS[operation].request.value)({}, {payload: payload(operation, owner, bytes)});
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
        run = (operation, owner, bytes) => operation === "list" ? invoke("get", "/api/asset-packages", {workspaceId: owner}) : invoke("post", `/api/asset-packages/${operation}`, payload(operation, owner, bytes));
      }
      const namespaces = ["asset-package/inspections", "asset-package/records"];
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
      const upload = Buffer.from(fixture.bytes);
      const inspecting = run("inspect", workspace.workspaceId, upload);
      upload.fill(0); // Caller cannot change bytes while authorization/readiness is pending.
      const inspected = await inspecting;
      assert.equal(inspected.ok, true, `${kind} ${JSON.stringify(inspected)}`);
      assert.equal(inspected.value.eligibleForAdmission, true);
      assert.equal((await run("list", workspace.workspaceId)).ok, true);
      const preserved = await snapshot();
      assert.equal(preserved[0].length, 1);
      assert.equal(preserved[1].length, 0); // Inspect never grants installation or activation.
      assert.equal((preserved[0][0].value as any).workspaceId, workspace.workspaceId);
      assert.equal((preserved[0][0].value as any).artifact.sizeBytes, fixture.bytes.length);
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
