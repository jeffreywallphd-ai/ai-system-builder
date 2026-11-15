import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createStructuredAssetImplementationRepository } from "../../../../adapters/persistence/asset-implementation";
import { initializeLocalIdentityProfile } from "../../../../adapters/security/local-identity";
import { composeDesktopWorkspaceAuthorization } from "../../../desktop/composition/composeDesktopWorkspaceAuthorization";
import { WorkspaceAssetAccessService } from "../../../../application/services/asset/workspace-asset-access.service";
import { AssetDerivedCustomizationTargetCatalogService } from "../../../../application/services/asset/asset-derived-customization-target-catalog.service";
import * as studio from "../../../../application/use-cases/asset-studio";
import * as packages from "../../../../application/use-cases/asset-package";
import { CreateAssetImplementationDraftUseCase } from "../../../../application/use-cases/asset-implementation";
import { AssetDerivedCustomizationWorkflowUseCase } from "../../../../application/use-cases/asset-authoring";
import { requireWorkspaceAssetAccess } from "../../../../application/services/asset/workspace-asset-access.service";
import { composeAssetDerivedCustomization } from "../composeAssetDerivedCustomization";

const deniedMessage = "Workspace asset access is unavailable or forbidden.";
const exactDefinition = {kind: "asset-definition-version", id: "asset.a", version: "1.0.0"};
const exactDerivedFields = {
  definitionRef: exactDefinition,
  implementationReleaseId: "release.a",
  baseDefinitionRef: exactDefinition,
  baseImplementationReleaseId: "release.a",
  derivedDefinitionRef: {...exactDefinition, id: "asset.derived"},
  semanticPatch: {"display-name": "Derived fixture"},
  expectedRevision: 1,
  actorId: "fixture-owner",
};

test("absent or failing resource admission remains sanitized and denies before deferred customization readiness", async () => {
  for (const access of [undefined, {async authorize() {throw new Error("private authority error");}}]) {
    await assert.rejects(requireWorkspaceAssetAccess(access as never, "workspace.a" as never, "asset-studio.read", "asset:read"), {message: deniedMessage});
  }
  let effects = 0;
  const workspaceAccess = {async authorize() {throw new Error("private policy");}};
  const composed = composeAssetDerivedCustomization({publication: {} as never, workspaceAccess, documents: createInMemoryStructuredDocumentStore(), definitions: {} as never, implementations: {repository: {}, backingResources: {}} as never, artifacts: {} as never, now: () => "2026-10-22T00:00:00Z", async ensureReady() {effects++;}});
  const input: any = {workspaceId: "workspace.a", customizationId: "customization.a", ...exactDerivedFields};
  for (const key of ["listTargets", "readTarget", "create", "update", "review", "publish", "abandon", "list"] as const) {
    await assert.rejects(composed.service[key](input), {message: deniedMessage});
  }
  await assert.rejects(composed.service.read(input.workspaceId, input.customizationId), {message: deniedMessage});
  assert.equal(effects, 0);
});

test("all Studio, package and derived application entries authorize before protected effects", async () => {
  let effects = 0;
  const requests: Array<{ operation: string; scope: string }> = [];
  const protectedPort = new Proxy({}, { get() { return async () => { effects++; throw new Error("private dependency detail"); }; } });
  const workspaceAccess = { async authorize(_workspace: unknown, operation: string, scope: string) { requests.push({operation, scope}); throw new Error("private actor detail"); } };
  const d: any = { workspaceAccess, workflows: protectedPort, drafts: protectedPort, definitions: protectedPort, implementations: protectedPort, artifacts: protectedPort, inspector: protectedPort, repository: protectedPort, packages: protectedPort, trust: protectedPort, backingResources: protectedPort, customizations: protectedPort, targets: protectedPort, snapshotSource: protectedPort, nextDraftId() { effects++; return "draft.a"; }, nextInspectionId() { effects++; return "inspection.a"; }, nextCustomizationId() { effects++; return "customization.a"; }, nextSnapshotId() { effects++; return "snapshot.a"; }, digestText() { effects++; return "sha256:unused"; }, now() { effects++; return "2026-10-22T00:00:00Z"; } };
  const command: any = {
    workspaceId: "workspace.a", ...exactDerivedFields,
    displayName: "Fixture", draftId: "draft.a", workflowId: "workflow.a", customizationId: "customization.a",
    implementationDraftId: "draft.a", mode: "manual", intent: "Review a fixture",
    context: [], allowedDependencies: [], allowedCapabilities: [],
    decision: "approve", approvedDependencies: [], approvedCapabilities: [],
    semanticDefinition: {assetType: "tool", assetFamily: "behavioral",
      displayName: "Fixture", description: "Workspace authorization test.", aiContext: {
        purpose: "Verify the admission order.", userFacingSummary: "Fixture tool.",
        developerFacingSummary: "Deterministic test data.", capabilities: [], limitations: [],
      }},
    resources: [{path: "frontend/view.tsx", role: "frontend-structure", mediaType: "text/typescript-jsx",
      content: 'export const View = () => "Fixture";'}],
    bytes: new Uint8Array([1, 2, 3]),
  };
  const draft = new studio.AssetStudioAssetDraftWorkflowUseCase(d);
  const derived = new AssetDerivedCustomizationWorkflowUseCase(d);
  const targets = new AssetDerivedCustomizationTargetCatalogService(d);
  const activate = new packages.ActivateAssetPackageUseCase(protectedPort as never, protectedPort as never, d.now, workspaceAccess);
  const actions = [
    () => new studio.StartAssetStudioUseCase(protectedPort as never, d.nextDraftId, workspaceAccess).execute(command),
    () => new studio.ProposeAssetStudioChangeUseCase(d).execute(command),
    () => new studio.ReviewAssetStudioProposalUseCase(d).execute(command),
    () => new studio.ReadAssetStudioProposalUseCase(protectedPort as never, protectedPort as never, workspaceAccess).execute(command.workspaceId, command.workflowId),
    () => new studio.ListAssetStudioWorkflowsUseCase(protectedPort as never, workspaceAccess).execute(command.workspaceId),
    ...(["create", "update", "read", "list", "review", "publish", "abandon"] as const).map(key => () => draft[key](command)),
    () => new packages.InspectAssetPackageUseCase(d).execute(command),
    () => new packages.AdmitAssetPackageUseCase(d).execute(command),
    () => activate.execute(command),
    () => new packages.DisableAssetPackageUseCase(protectedPort as never, protectedPort as never, d.now, workspaceAccess).execute(command),
    () => new packages.RollbackAssetPackageUseCase(protectedPort as never, activate, workspaceAccess).execute(command),
    () => new packages.ListAssetPackagesUseCase(protectedPort as never, workspaceAccess).execute(command.workspaceId),
    () => targets.list(command), () => targets.read(command),
    ...(["create", "update", "review", "publish", "abandon"] as const).map(key => () => derived[key](command)),
    () => derived.read(command.workspaceId, command.customizationId), () => derived.list(command),
  ];
  for (const [index, action] of actions.entries()) {
    const before = requests.length;
    let result: any;
    try { result = await action(); }
    catch (error) {
      assert.equal((error as Error).message, deniedMessage);
      assert.equal(requests.length, before + 1, `Action ${index + 1} did not authorize exactly once.`);
      continue;
    }
    assert.equal(requests.length, before + 1, `Action ${index + 1} did not authorize exactly once.`);
    assert.ok(result?.ok === false || result?.kind === "failure");
    assert.ok(!JSON.stringify(result).includes("private"));
  }
  assert.equal(actions.length, 27);
  assert.equal(requests.length, actions.length);
  assert.equal(requests.filter(request => request.scope === "asset:read").length, 9);
  assert.ok(requests.every(request => request.operation.startsWith("asset-")));
  assert.equal(effects, 0);
});

test("real organization and persisted workspace policy denies unknown resources but permits a valid Studio draft", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  let serial = 0;
  const identity = await initializeLocalIdentityProfile({ documents, organizationDisplayName: "Fixture", principalDisplayName: "Fixture", now: () => "2026-10-22T00:00:00Z", createId: () => `assets.${++serial}` });
  const workspace: any = { workspaceId: "workspace.a", organizationId: identity.organizationId, status: "active", displayName: "Fixture", createdAt: "2026-10-22T00:00:00Z", updatedAt: "2026-10-22T00:00:00Z" };
  const allowed = composeDesktopWorkspaceAuthorization({ documents, localIdentity: identity });
  const foreignActor = composeDesktopWorkspaceAuthorization({ documents, localIdentity: { ...identity, principalId: "principal.unknown" as never } });
  const repository = createStructuredAssetImplementationRepository(documents.forOrganization(identity.organizationId));
  let generated = 0;
  const command: any = { workspaceId: workspace.workspaceId, definitionRef: {kind: "asset-definition-version", id: "asset.a", version: "1.0.0"}, displayName: "Fixture", actorId: identity.principalId };
  for (const [authority, record] of [[undefined, workspace], [foreignActor, workspace], [allowed, undefined], [allowed, {...workspace, status: "archived"}], [allowed, {...workspace, organizationId: "organization.foreign"}], [allowed, {...workspace, workspaceId: "workspace.other"}]]) {
    const workspaceAccess = new WorkspaceAssetAccessService({ workspaceRepository: {readWorkspace: async () => record}, workspaceAuthorization: authority });
    const start = new studio.StartAssetStudioUseCase(new CreateAssetImplementationDraftUseCase(repository, () => workspace.createdAt), () => {generated++; return "draft.a" as never;}, workspaceAccess);
    const result = await start.execute(command);
    assert.equal(result.ok, false);
  }
  assert.equal(generated, 0);
  assert.equal((await documents.forOrganization(identity.organizationId).listDocuments("asset-implementation/drafts")).length, 0);
  const workspaceAccess = new WorkspaceAssetAccessService({ workspaceRepository: {readWorkspace: async () => workspace}, workspaceAuthorization: allowed });
  const result = await new studio.StartAssetStudioUseCase(new CreateAssetImplementationDraftUseCase(repository, () => workspace.createdAt), () => "draft.allowed" as never, workspaceAccess).execute(command);
  assert.equal(result.ok, true);
  assert.ok(await repository.readDraft(command.workspaceId, "draft.allowed" as never));
});
