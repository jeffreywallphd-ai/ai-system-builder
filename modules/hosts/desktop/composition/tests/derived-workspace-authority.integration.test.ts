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
import { DESKTOP_ASSET_PACKAGE_CHANNELS, DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS } from "../../../../contracts/ipc";
import { setExpressAuthContext } from "../../../../adapters/transport/api-express/security/expressAuthContext";

test("derived desktop and server requests use current workspace access and preserve denied state", {timeout: 60_000}, async () => {
  for (const kind of ["desktop", "server"] as const) {
    const ownedRoot = await mkdtemp(join(tmpdir(), "derived-authority-"));
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
      const operations = ["create", "update", "review", "publish", "abandon", "read", "list", "listTargets", "readTarget"] as const;
      type Operation = typeof operations[number];
      const baseRef = fixture.container.manifest.implementations[0].definitionRef;
      const releaseId = fixture.container.manifest.implementations[0].releaseId;
      const patch = () => ({"display-name": "Original derived asset", "ai-context": {purpose: "Exercise derived customization", userFacingSummary: "A useful derived view", developerFacingSummary: "A deterministic local fixture", capabilities: [{summary: "Show a derived view"}], limitations: [{summary: "Test fixture"}]}});
      const changes = () => [{operation: "upsert", path: "src/derived.ts", role: "frontend-structure", mediaType: "text/typescript", content: "export const derivedView = () => 'Original';"}];
      const payload = (operation: Operation, workspaceId: string, extra: any = {}) => ({workspaceId, baseDefinitionRef: {...baseRef}, definitionRef: {...baseRef}, baseImplementationReleaseId: releaseId, implementationReleaseId: releaseId, derivedDefinitionRef: {kind: "asset-definition-version", id: "asset.host-derived", version: "1.0.0"}, customizationId: "customization.absent", expectedRevision: 1, semanticPatch: patch(), sourceChanges: changes(), ...extra});
      let run: (operation: Operation, workspaceId: string, extra?: any) => Promise<any>;
      let installBase: () => Promise<void>;
      let desktop: ReturnType<typeof composeDesktopHost> | undefined;
      const logs: any[] = [];
      if (kind === "desktop") {
        const handlers = new Map<string, any>();
        const host = composeDesktopHost({persistence: {documents, organizationDocuments}, localIdentity: identity, now: () => at, logSink: entry => {logs.push(entry);}});
        desktop = host;
        host.registerDesktopIpc({ipcMain: {handle(channel, handler) {handlers.set(channel, handler);}}, senderTrust: {isTrustedSender: () => true}, storageRootDirectory: ownedRoot, runtimeRootDirectory: join(ownedRoot, "runtime")});
        run = (operation, owner, extra) => handlers.get(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS[operation].request.value)({}, {payload: payload(operation, owner, extra)});
        installBase = async () => {
          const inspect = await handlers.get(DESKTOP_ASSET_PACKAGE_CHANNELS.inspect.request.value)({}, {payload: {workspaceId: workspace.workspaceId, bytes: fixture.bytes}});
          assert.equal(inspect.ok, true, JSON.stringify(inspect));
          const admitted = await handlers.get(DESKTOP_ASSET_PACKAGE_CHANNELS.admit.request.value)({}, {payload: {workspaceId: workspace.workspaceId, inspectionId: inspect.value.inspectionId, packageDigest: inspect.value.packageDigest, approvalScope: "workspace", approvedCapabilities: []}});
          assert.equal(admitted.ok, true, JSON.stringify(admitted));
        };
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
        const prefix = "/api/asset-authoring/workspaces/:workspaceId";
        const urls: Record<Operation, [string, string]> = {create: ["post", "/derived-customizations"], update: ["patch", "/derived-customizations/:customizationId"], review: ["post", "/derived-customizations/:customizationId/review"], publish: ["post", "/derived-customizations/:customizationId/publish"], abandon: ["post", "/derived-customizations/:customizationId/abandon"], read: ["get", "/derived-customizations/:customizationId"], list: ["get", "/derived-customizations"], listTargets: ["get", "/customization-targets"], readTarget: ["get", "/customization-targets/:implementationReleaseId"]};
        run = (operation, owner, extra) => {const value = payload(operation, owner, extra); return invoke(urls[operation][0], prefix+urls[operation][1], {...value, definitionId: baseRef.id, definitionVersion: baseRef.version}, {workspaceId: owner, customizationId: value.customizationId, implementationReleaseId: releaseId});};
        installBase = async () => {
          const inspect = await invoke("post", "/api/asset-packages/inspect", {workspaceId: workspace.workspaceId, contentBase64: Buffer.from(fixture.bytes).toString("base64")});
          assert.equal(inspect.ok, true, JSON.stringify(inspect));
          const admitted = await invoke("post", "/api/asset-packages/admit", {workspaceId: workspace.workspaceId, inspectionId: inspect.value.inspectionId, packageDigest: inspect.value.packageDigest, approvalScope: "workspace", approvedCapabilities: []});
          assert.equal(admitted.ok, true, JSON.stringify(admitted));
        };
      }
      const namespaces = ["asset-authoring/derived-customizations", "asset-implementation/drafts", "asset-implementation/source-snapshots"];
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
      await installBase();
      const targets = await run("listTargets", workspace.workspaceId, {text: String(baseRef.id), limit: 100});
      assert.equal(targets.ok, true, JSON.stringify(targets));
      assert.ok(targets.value.targets.some((target: any) => target.implementationReleaseId === releaseId && target.eligibility.eligible), JSON.stringify({kind, releaseId, targets: targets.value.targets}));
      const target = await run("readTarget", workspace.workspaceId);
      assert.equal(target.ok, true, JSON.stringify(target)); assert.equal(target.value.eligibility.eligible, true);
      const original = payload("create", workspace.workspaceId);
      const creating = run("create", workspace.workspaceId, original);
      original.semanticPatch["display-name"] = "Changed"; original.sourceChanges[0].content = "Changed"; original.baseDefinitionRef.id = "asset.changed";
      const created = await creating;
      assert.equal(created.ok, true, `${kind} ${JSON.stringify(created)}`);
      assert.equal(created.value.semanticPatch["display-name"], "Original derived asset");
      assert.ok(created.value.sourceOverlay); assert.ok(!JSON.stringify(created.value).includes("export const derivedView"));
      const customizationId = created.value.customizationId;
      const opened = await run("read", workspace.workspaceId, {customizationId}); assert.equal(opened.ok, true, JSON.stringify(opened));
      const updated = await run("update", workspace.workspaceId, {customizationId, expectedRevision: 1}); assert.equal(updated.ok, true, JSON.stringify(updated));
      const reviewed = await run("review", workspace.workspaceId, {customizationId, expectedRevision: 2}); assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
      const published = await run("publish", workspace.workspaceId, {customizationId, expectedRevision: 3}); assert.equal(published.ok, true, JSON.stringify(published));
      assert.equal(published.value.status, "published"); assert.equal((await run("list", workspace.workspaceId)).ok, true);
      const preserved = await snapshot(); assert.equal(preserved[0].length, 1);
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
