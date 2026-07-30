import { describe, expect, it } from "../../../../testing/node-test";
import type { ModelInventoryRecord } from "../../../../contracts/model";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { SystemBuilderModelAuthorityService } from "../../../services/system-builder";
import { ListSystemBuilderModelOptionsUseCase } from "../list-system-builder-model-options.use-case";

const workspaceId = createWorkspaceId("workspace-model-options");

const record: ModelInventoryRecord = {
  workspaceId,
  modelRecordId: "model.chat",
  displayName: "Chat model",
  source: "local",
  lifecycleStatus: "validated",
  artifactForm: "full-model",
  provider: "huggingface",
  modelId: "local/chat",
  createdAt: "2026-07-29T00:00:00.000Z",
  taskTags: ["chat"],
  validationStatus: "valid",
};

describe("ListSystemBuilderModelOptionsUseCase", () => {
  it("returns only the sanitized authorized catalog", async () => {
    const useCase = new ListSystemBuilderModelOptionsUseCase(
      new SystemBuilderModelAuthorityService({
        async listModels() {
          return { models: [record] };
        },
        async getModelRecord() {
          return record;
        },
      }),
    );

    const result = await useCase.execute({ workspaceId });

    expect(result).toMatchObject({
      ok: true,
      value: {
        options: [
          {
            displayName: "Chat model",
            binding: {
              kind: "model-record",
              modelRecordId: "model.chat",
            },
          },
        ],
      },
    });
    expect(JSON.stringify(result).includes("local/chat")).toBe(false);
  });

  it("returns a bounded unavailable failure when the registry cannot be read", async () => {
    const useCase = new ListSystemBuilderModelOptionsUseCase(
      new SystemBuilderModelAuthorityService({
        async listModels() {
          throw new Error("C:\\private\\models\\registry.json");
        },
        async getModelRecord() {
          return undefined;
        },
      }),
    );

    const result = await useCase.execute({ workspaceId });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "unavailable",
        message: "Compatible models are unavailable for this workspace.",
      },
    });
  });
});
