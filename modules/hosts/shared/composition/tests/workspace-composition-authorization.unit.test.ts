import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createLocalAssetCompositionPlanRepositoryAdapter } from "../../../../adapters/persistence/asset-composition";
import { initializeLocalIdentityProfile } from "../../../../adapters/security/local-identity";
import { composeDesktopWorkspaceAuthorization } from "../../../desktop/composition/composeDesktopWorkspaceAuthorization";
import { WorkspaceAssetAccessService } from "../../../../application/services/asset/workspace-asset-access.service";
import { WorkspaceAssetCompositionReadModelService } from "../../../../application/services/asset/workspace-asset-composition-read-model.service";
import * as useCases from "../../../../application/use-cases/asset-composition";

test("real organization policy gates composition before protected reads or writes", async () => {
  const documents = createInMemoryStructuredDocumentStore(); let sequence = 0;
  const identity = await initializeLocalIdentityProfile({documents, organizationDisplayName: "Fixture", principalDisplayName: "Fixture", now: () => "2026-10-21T00:00:00Z", createId: () => `composition.${++sequence}`});
  const workspace: any = {workspaceId: "workspace.a", organizationId: identity.organizationId, status: "active", displayName: "Fixture", createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z"};
  const allowed = composeDesktopWorkspaceAuthorization({documents, localIdentity: identity});
  const foreignActor = composeDesktopWorkspaceAuthorization({documents, localIdentity: {...identity, principalId: "principal.unknown" as never}});
  let effects = 0;
  const protectedRepository: any = new Proxy({}, {get() {return async () => {effects++; throw new Error("protected repository must not be reached");};}});
  for (const [authority, record] of [[undefined, workspace], [foreignActor, workspace], [allowed, {...workspace, organizationId: "organization.foreign"}], [allowed, {...workspace, status: "archived"}], [allowed, {...workspace, workspaceId: "workspace.other"}], [allowed, undefined]]) {
    const workspaceAccess = new WorkspaceAssetAccessService({workspaceRepository: {readWorkspace: async () => record}, workspaceAuthorization: authority});
    const created = await new useCases.CreateAssetCompositionPlanUseCase({repository: protectedRepository, workspaceAccess, generatePlanId: () => "plan.a"}).execute({targetWorkspaceId: workspace.workspaceId, name: "Fixture"});
    assert.equal(created.status, "failure");
    const reads = new WorkspaceAssetCompositionReadModelService({compositionPlanRepository: protectedRepository, workspaceAccess});
    await assert.rejects(reads.listPlansNeedingAttention({targetWorkspaceId: workspace.workspaceId}));
  }
  assert.equal(effects, 0);
  const repository = createLocalAssetCompositionPlanRepositoryAdapter({rootDir: "composition-authorization-fixture", documents});
  const workspaceAccess = new WorkspaceAssetAccessService({workspaceRepository: {readWorkspace: async () => workspace}, workspaceAuthorization: allowed});
  const result = await new useCases.CreateAssetCompositionPlanUseCase({repository, workspaceAccess, generatePlanId: () => "plan.allowed"}).execute({targetWorkspaceId: workspace.workspaceId, name: "Allowed"});
  assert.equal(result.status, "success");
  const listed = await new WorkspaceAssetCompositionReadModelService({compositionPlanRepository: repository, workspaceAccess}).listPlansNeedingAttention({targetWorkspaceId: workspace.workspaceId});
  assert.ok(Array.isArray(listed));
});

test("every composition entry checks its fixed scope before repository or projection access", async () => {
  let effects = 0; const requests: Array<{scope: string; operation: string}> = [];
  const repository: any = new Proxy({}, {get() {return async () => {effects++; throw new Error("protected");};}});
  const workspaceAccess = {async authorize(_workspace: unknown, operation: string, scope: "asset:read" | "asset:write") {requests.push({operation, scope}); throw new Error("private denial");}};
  const d = {repository, projectionRepository: repository, workspaceAccess, generatePlanId: () => "plan.a", generateNodeId: () => "node.a", generateRelationshipId: () => "relationship.a"};
  const common: any = {targetWorkspaceId: "workspace.a", planId: "plan.a", name: "Fixture", projectionId: "projection.a", sourceNodeId: "node.a", targetNodeId: "node.b", relationshipKind: "depends-on", relationshipId: "relationship.a"};
  const entries = [new useCases.CreateAssetCompositionPlanUseCase(d), new useCases.UpdateAssetCompositionPlanUseCase(d), new useCases.ReadAssetCompositionPlanUseCase(d), new useCases.ListAssetCompositionPlansUseCase(d), new useCases.ArchiveAssetCompositionPlanUseCase(d), new useCases.AddProjectionToCompositionPlanUseCase(d), new useCases.RemoveProjectionFromCompositionPlanUseCase(d), new useCases.ConnectCompositionNodesUseCase(d), new useCases.DisconnectCompositionNodesUseCase(d), new useCases.ValidateAssetCompositionPlanUseCase(d)];
  for (const entry of entries) {const result = await entry.execute(common); assert.equal(result.status, "failure"); assert.ok(!JSON.stringify(result).includes("private denial"));}
  assert.equal(requests.length, 10); assert.equal(requests.filter(request => request.scope === "asset:read").length, 2); assert.equal(requests.at(-1)?.scope, "asset:write", "Validation persists state and requires write authority.");
  const readModel = new WorkspaceAssetCompositionReadModelService({compositionPlanRepository: repository, workspaceAccess});
  const query: any = {...common, effectiveAssetReference: {kind: "asset-instance", id: "instance.a"}};
  for (const read of [() => readModel.listCompositionPlanSummaries(query), () => readModel.readCompositionPlanDetail(query), () => readModel.listPlansForProjection(query), () => readModel.listPlansForEffectiveAssetReference(query), () => readModel.listPlansNeedingAttention(query)]) await assert.rejects(read());
  assert.equal(requests.length, 15); assert.ok(requests.slice(10).every(request => request.scope === "asset:read")); assert.equal(effects, 0);
});
