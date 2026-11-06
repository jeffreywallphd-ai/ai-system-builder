import assert from "node:assert/strict";
import { test } from "node:test";

import { createWorkspaceId } from "../../../../contracts/workspace";
import type { DeleteModelRecordRequest, ModelInventoryRecord } from "../../../../contracts/model";
import type { ArtifactCatalogDeletePort } from "../../../ports/artifact-catalog";
import {
  ModelLocalFileEffectsUnavailableError,
  type ModelLocalFilesDeletePort,
  type ModelRegistryPort,
} from "../../../ports/model";
import { DeleteModelRecordUseCase } from "../delete-model-record.use-case";

const identity = { workspaceId: createWorkspaceId("workspace-1"), modelRecordId: "model-1" };
const localModel: ModelInventoryRecord = {
  modelRecordId: identity.modelRecordId,
  displayName: "Test model",
  source: "local",
  lifecycleStatus: "downloaded",
  artifactForm: "full-model",
  provider: "huggingface",
  localPath: "C:\\synthetic\\model",
  backingArtifactIds: ["synthetic-model-artifact"],
  createdAt: "2026-07-31T00:00:00.000Z",
};

function unexpectedRegistryCall(): never {
  assert.fail("Unexpected registry operation");
}

function fixture(record: ModelInventoryRecord, localResult?: boolean | ModelLocalFileEffectsUnavailableError) {
  const steps: string[] = [];
  const modelLocalFilesDeletePort: ModelLocalFilesDeletePort | undefined = localResult === undefined
    ? undefined
    : {
        async deleteLocalModelFiles(input) {
          steps.push("local");
          assert.deepEqual(input, identity);
          if (localResult instanceof Error) throw localResult;
          return { deleted: localResult };
        },
      };
  const artifactCatalogDeletePort: ArtifactCatalogDeletePort = {
    async deleteArtifactCatalogRecord() {
      steps.push("catalog");
      return { ok: true, value: { deleted: true } };
    },
  };
  const modelRegistry: ModelRegistryPort = {
    listModels: unexpectedRegistryCall,
    saveModelReference: unexpectedRegistryCall,
    registerDownloadedModel: unexpectedRegistryCall,
    registerGeneratedModel: unexpectedRegistryCall,
    updateModelRecord: unexpectedRegistryCall,
    async getModelRecord(workspaceId: string, modelRecordId: string) {
      steps.push("read");
      assert.deepEqual({ workspaceId, modelRecordId }, identity);
      return record;
    },
    async deleteModelRecord(request: DeleteModelRecordRequest) {
      steps.push("registry");
      assert.equal(request.workspaceId, identity.workspaceId);
      assert.equal(request.modelRecordId, identity.modelRecordId);
      return {
        deletedModelRecordId: request.modelRecordId,
        deletedRegistryRecord: true,
        deletedLocalFiles: false,
        deletedBackingArtifactIds: [],
      };
    },
  };
  const useCase = new DeleteModelRecordUseCase({
    modelRegistry,
    artifactCatalogDeletePort,
    modelLocalFilesDeletePort,
  });
  return { useCase, steps };
}

for (const scenario of [
  { label: "has no stored location", record: { ...localModel, localPath: undefined }, result: true, steps: ["read"] },
  { label: "has no file-effects port", record: localModel, result: undefined, steps: ["read"] },
  { label: "reports no deletion", record: localModel, result: false, steps: ["read", "local"] },
  { label: "refuses the file action", record: localModel, result: new ModelLocalFileEffectsUnavailableError(), steps: ["read", "local"] },
] as const) {
  test(`keeps model and catalog records when local deletion ${scenario.label}`, async () => {
    const { useCase, steps } = fixture(scenario.record, scenario.result);
    await assert.rejects(
      useCase.execute({ ...identity, deleteLocalFiles: true, deleteBackingArtifacts: true }),
      ModelLocalFileEffectsUnavailableError,
    );
    assert.deepEqual(steps, scenario.steps);
  });
}

test("removes the record after the port confirms the exact model file deletion", async () => {
  const { useCase, steps } = fixture(localModel, true);
  assert.deepEqual(await useCase.execute({ ...identity, deleteLocalFiles: true }), {
    deletedModelRecordId: identity.modelRecordId,
    deletedRegistryRecord: true,
    deletedLocalFiles: true,
    deletedBackingArtifactIds: [],
  });
  assert.deepEqual(steps, ["read", "local", "registry"]);
});

test("supports removing the record alone without calling file or catalog effects", async () => {
  const { useCase, steps } = fixture(localModel, true);
  const result = await useCase.execute({ ...identity, deleteLocalFiles: false });
  assert.equal(result.deletedRegistryRecord, true);
  assert.equal(result.deletedLocalFiles, false);
  assert.deepEqual(steps, ["read", "registry"]);
});
