import assert from "node:assert/strict";
import test from "node:test";
import { CreateWorkspaceAuthoredAssetUseCase, CreateAssetDraftUseCase, UpdateAssetDraftUseCase, PublishAssetDraftUseCase, CreateAssetOverrideUseCase, UpdateAssetOverrideUseCase, DisableAssetOverrideUseCase } from "..";

const workspaceId = "workspace.legacy-test";
const cases = [
  [CreateWorkspaceAuthoredAssetUseCase, {workspaceId, initialEditableValues: {"display-name": "Example"}}],
  [CreateAssetDraftUseCase, {targetWorkspaceId: workspaceId, draftEditableValues: {"display-name": "Example"}}],
  [UpdateAssetDraftUseCase, {targetWorkspaceId: workspaceId, draftId: "draft.test", draftEditablePatch: {summary: "Updated"}}],
  [PublishAssetDraftUseCase, {targetWorkspaceId: workspaceId, draftId: "draft.test"}],
  [CreateAssetOverrideUseCase, {targetWorkspaceId: workspaceId, target: {targetWorkspaceId: workspaceId, sourceKind: "workspace-local-asset", effectiveAssetReference: {kind: "asset-instance", id: "asset.test", version: "1.0.0"}}, overrideValues: {summary: "Updated"}}],
  [UpdateAssetOverrideUseCase, {targetWorkspaceId: workspaceId, overrideId: "override.test", overrideValues: {summary: "Updated"}}],
  [DisableAssetOverrideUseCase, {targetWorkspaceId: workspaceId, overrideId: "override.test"}],
] as const;

const operations: Readonly<Record<string, string>> = {
  "CreateWorkspaceAuthoredAssetUseCase": "create-workspace-authored-asset",
  "CreateAssetDraftUseCase": "create-asset-draft",
  "UpdateAssetDraftUseCase": "update-asset-draft",
  "PublishAssetDraftUseCase": "publish-asset-draft",
  "CreateAssetOverrideUseCase": "create-asset-override",
  "UpdateAssetOverrideUseCase": "update-asset-override",
  "DisableAssetOverrideUseCase": "disable-asset-override"
};

for (const [UseCase, command] of cases) for (const mode of ["absent", "throwing", "denied"] as const) test(`${UseCase.name}: ${mode} authority denies before repository, target, clock or ID effects`, async () => {
  let effects = 0, authorizations = 0;
  const denied = () => {effects++; throw new Error("Protected effect reached");};
  const repository = new Proxy({}, {get: () => denied});
  const dependencies = {workspaceAccess: mode === "absent" ? undefined : {async authorize(ws: string, operation: string, scope: string) {authorizations++; assert.equal(ws, workspaceId); assert.equal(scope, "asset:write"); assert.equal(operation, `asset-authoring.${operations[UseCase.name]}`); throw new Error(mode === "throwing" ? "private policy detail" : "denied");}}, authoredAssetRepository: repository, assetDraftRepository: repository, assetRevisionRepository: repository, assetOverrideRepository: repository, targetReader: repository, generateAuthoredAssetId: denied, generateAssetDraftId: denied, generateAssetRevisionId: denied, generateAssetOverrideId: denied, now: denied};
  const result = await new (UseCase as any)(dependencies).execute(command);
  assert.equal(result.kind, "failure"); assert.equal(effects, 0); assert.equal(authorizations, mode === "absent" ? 0 : 1);
  assert.ok(!JSON.stringify(result).includes("private policy detail"));
});
