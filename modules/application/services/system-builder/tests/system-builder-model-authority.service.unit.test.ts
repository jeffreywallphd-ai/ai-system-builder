import { describe, expect, it } from "../../../../testing/node-test";
import type { ModelInventoryRecord } from "../../../../contracts/model";
import {
  createSystemBuilderModelBinding,
  readSystemBuilderModelBinding,
} from "../../../../contracts/system-builder";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { SystemBuilderModelAuthorityService } from "../system-builder-model-authority.service";

const workspaceId = createWorkspaceId("workspace-model-authority");

function model(
  overrides: Partial<ModelInventoryRecord> = {},
): ModelInventoryRecord {
  return {
    workspaceId,
    modelRecordId: "model.chat.local",
    displayName: "Local chat model",
    source: "local",
    lifecycleStatus: "downloaded",
    artifactForm: "full-model",
    provider: "huggingface",
    modelId: "local/chat-model",
    createdAt: "2026-07-29T00:00:00.000Z",
    taskTags: ["chat", "text-generation"],
    validationStatus: "valid",
    ...overrides,
  };
}

function authority(records: readonly ModelInventoryRecord[]) {
  return new SystemBuilderModelAuthorityService({
    async listModels() {
      return { models: [...records] };
    },
    async getModelRecord(requestedWorkspaceId, modelRecordId) {
      return records.find(
        (record) =>
          record.workspaceId === requestedWorkspaceId &&
          record.modelRecordId === modelRecordId,
      );
    },
  });
}

describe("SystemBuilderModelAuthorityService", () => {
  it("normalizes safe exact bindings and rejects path-shaped identifiers", () => {
    const binding = createSystemBuilderModelBinding(" model.chat.local ");
    expect(binding).toEqual({
      schemaVersion: "1.0",
      kind: "model-record",
      id: "model.chat.local",
      modelRecordId: "model.chat.local",
    });
    expect(readSystemBuilderModelBinding(binding)).toEqual(binding);
    expect(
      readSystemBuilderModelBinding({
        schemaVersion: "1.0",
        kind: "model-record",
        modelRecordId: "model.chat.local",
      }),
    ).toEqual(binding);
    expect(
      readSystemBuilderModelBinding({
        ...binding,
        id: "model.other",
      }),
    ).toBe(undefined);
    expect(readSystemBuilderModelBinding({ kind: "model-record" })).toBe(
      undefined,
    );
    expect(() => createSystemBuilderModelBinding("../other-model")).toThrow();
  });

  it("projects only runnable text models without provider or path details", async () => {
    const result = await authority([
      model(),
      model({
        modelRecordId: "model.embedding",
        displayName: "Embedding model",
        taskTags: ["embeddings"],
      }),
      model({
        modelRecordId: "model.saved",
        displayName: "Saved reference",
        lifecycleStatus: "saved-reference",
      }),
      model({
        modelRecordId: "model.other-workspace",
        displayName: "Other workspace",
        workspaceId: createWorkspaceId("workspace-other"),
      }),
    ]).listCompatible(workspaceId);

    expect(result).toEqual([
      {
        binding: createSystemBuilderModelBinding("model.chat.local"),
        displayName: "Local chat model",
        lifecycleStatus: "downloaded",
        taskTags: ["chat", "text-generation"],
      },
    ]);
    expect("provider" in result[0]!).toBe(false);
    expect("modelId" in result[0]!).toBe(false);
    expect("localPath" in result[0]!).toBe(false);
  });

  it("fails closed for missing, cross-workspace, incompatible, and unusable models", async () => {
    expect(await authority([]).resolve(workspaceId, undefined)).toMatchObject({
      status: "denied",
      code: "model-binding-missing",
    });

    const forgedRegistry = new SystemBuilderModelAuthorityService({
      async listModels() {
        return { models: [] };
      },
      async getModelRecord() {
        return model({ workspaceId: createWorkspaceId("workspace-other") });
      },
    });
    expect(
      await forgedRegistry.resolve(
        workspaceId,
        createSystemBuilderModelBinding("model.chat.local"),
      ),
    ).toMatchObject({
      status: "denied",
      code: "model-binding-workspace-mismatch",
    });

    expect(
      await authority([model({ taskTags: ["embeddings"] })]).resolve(
        workspaceId,
        createSystemBuilderModelBinding("model.chat.local"),
      ),
    ).toMatchObject({
      status: "denied",
      code: "model-binding-incompatible",
    });

    expect(
      await authority([
        model({ lifecycleStatus: "invalid", validationStatus: "invalid" }),
      ]).resolve(
        workspaceId,
        createSystemBuilderModelBinding("model.chat.local"),
      ),
    ).toMatchObject({
      status: "denied",
      code: "model-binding-not-runnable",
    });
  });
});
