import assert from "node:assert/strict";
import { test } from "node:test";
import { ReadWorkspaceSummaryUseCase } from "../read-workspace-summary.use-case";
import { createWorkspaceId, normalizeReadWorkspaceSummaryRequest, normalizeWorkspaceSummary } from "../../../../contracts/workspace";

const workspaceId = createWorkspaceId("workspace.a");
test("summary authorization precedes each protected group and independent metrics survive failure", async () => {
  let modelReads = 0; let assetReads = 0;
  const useCase = new ReadWorkspaceSummaryUseCase({
    workspaceRepository: {readWorkspace: async () => ({workspaceId, status: "active", organizationId: "organization.a"}) as any},
    authorization: {async authorizeWorkspaceOperation(request) {
      assert.equal(request.workspace.organizationId, "organization.a");
      if (request.operation === "workspace.summary.models") throw new Error("private denied detail");
    }},
    projections: {systems: async () => ({systemsPublished: 7}), datasets: async () => {throw new Error("private adapter detail");},
      models: async () => {modelReads++; return {modelsTrained: 100};}, assets: async () => {assetReads++; return {customAssets: 11};}},
  });
  const summary = await useCase.execute({workspaceId, page: "home"});
  assert.deepEqual(summary.metrics, {systemsPublished: {status: "available", value: 7}, modelsTrained: {status: "unavailable"}, datasetsCreated: {status: "unavailable"}, customAssets: {status: "available", value: 11}});
  assert.equal(modelReads, 0); assert.equal(assetReads, 1);
  assert.ok(!JSON.stringify(summary).includes("private"));
  assert.deepEqual(normalizeWorkspaceSummary(summary, {workspaceId, page: "home"}), summary);
});

test("missing authority, unavailable workspace and malformed requests perform no projection reads", async () => {
  let reads = 0;
  const dependencies = {workspaceRepository: {readWorkspace: async () => ({workspaceId, status: "active"}) as any},
    authorization: {async authorizeWorkspaceOperation() {throw new Error("No principal");}}, projections: {models: async () => {reads++; return {modelsInstalled: 1};}}};
  const useCase = new ReadWorkspaceSummaryUseCase(dependencies);
  await assert.rejects(useCase.execute({workspaceId, page: "models"})); assert.equal(reads, 0);
  dependencies.workspaceRepository.readWorkspace = async () => undefined;
  await assert.rejects(useCase.execute({workspaceId, page: "models"})); assert.equal(reads, 0);
  for (const invalid of [null, {}, {workspaceId, page: "__proto__"}, {workspaceId, page: "models", principalId: "spoof"}, {workspaceId: "../other", page: "models"}]) assert.throws(() => normalizeReadWorkspaceSummaryRequest(invalid));
});
