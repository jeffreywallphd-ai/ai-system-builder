import { describe, expect, it } from "../../../../testing/node-test";
import {
  normalizeAssetId,
  type AssetDefinition,
  type AssetInstance,
} from "../../../../contracts/asset";
import type { ModelInventoryRecord } from "../../../../contracts/model";
import {
  createSystemBuilderModelBinding,
  SYSTEM_BUILDER_MODEL_BINDING_FIELD_ID,
  type SystemBuilderRevision,
} from "../../../../contracts/system-builder";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { SystemBuilderModelAuthorityService } from "../system-builder-model-authority.service";
import { ValidateSystemBuilderRevisionService } from "../validate-system-builder-revision.service";

const workspaceId = createWorkspaceId("workspace-chat-validation");
const compositionId = normalizeAssetId("composition.chat-validation");
const definition: AssetDefinition = {
  definitionId: normalizeAssetId("conversation.message-composer"),
  assetType: "ui-component",
  assetFamily: "composition",
  version: "1.0.0",
  displayName: "Message composer",
  description: "Message composer",
  lifecycleStatus: "published",
  provenance: { sourceKind: "system-generated" },
  configurationSchema: {
    schemaVersion: "1.0",
    strict: true,
    fields: [
      {
        fieldId: SYSTEM_BUILDER_MODEL_BINDING_FIELD_ID,
        valueKind: "resource-reference",
        label: "Text generation model",
        required: true,
        metadata: { resourceKind: "model" },
      },
    ],
    requiredFieldIds: [SYSTEM_BUILDER_MODEL_BINDING_FIELD_ID],
  },
};

function model(
  overrides: Partial<ModelInventoryRecord> = {},
): ModelInventoryRecord {
  return {
    workspaceId,
    modelRecordId: "model.chat.local",
    displayName: "Chat model",
    source: "local",
    lifecycleStatus: "validated",
    artifactForm: "full-model",
    provider: "huggingface",
    modelId: "local/chat",
    createdAt: "2026-07-29T00:00:00.000Z",
    taskTags: ["chat"],
    validationStatus: "valid",
    ...overrides,
  };
}

function revision(
  selectedConfiguration: AssetInstance["selectedConfiguration"],
): Pick<
  SystemBuilderRevision,
  | "targetWorkspaceId"
  | "composition"
  | "instances"
  | "bindings"
  | "structure"
  | "placements"
> {
  const instance: AssetInstance = {
    instanceId: normalizeAssetId("instance.chat-composer"),
    definitionRef: {
      kind: "asset-definition-version",
      id: normalizeAssetId(String(definition.definitionId)),
      version: definition.version,
    },
    lifecycleStatus: "draft",
    selectedConfiguration,
    parentCompositionRef: { kind: "asset-composition", id: compositionId },
    provenance: { sourceKind: "human-authored" },
  };
  return {
    targetWorkspaceId: workspaceId,
    composition: {
      compositionId,
      compositionType: "system",
      displayName: "Chat",
      version: "0.1.0",
      lifecycleStatus: "draft",
      rootInstanceRefs: [
        { kind: "asset-instance", id: normalizeAssetId(String(instance.instanceId)) },
      ],
      instanceRefs: [
        { kind: "asset-instance", id: normalizeAssetId(String(instance.instanceId)) },
      ],
      bindingRefs: [],
      provenance: { sourceKind: "human-authored" },
    },
    instances: [instance],
    bindings: [],
  };
}

function validator(records: readonly ModelInventoryRecord[]) {
  const authority = new SystemBuilderModelAuthorityService({
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
  return new ValidateSystemBuilderRevisionService(
    { readExactDefinition: async () => definition },
    () => "2026-07-29T00:00:00.000Z",
    authority,
  );
}

describe("System Builder model-binding validation", () => {
  it("accepts an exact runnable workspace model", async () => {
    const result = await validator([model()]).execute(
      revision({
        [SYSTEM_BUILDER_MODEL_BINDING_FIELD_ID]:
          createSystemBuilderModelBinding("model.chat.local"),
      }),
    );
    expect(result.status).toBe("valid");
    expect(result.issues).toEqual([]);
  });

  it("denies missing and stale model bindings with bounded diagnostics", async () => {
    const missing = await validator([model()]).execute(revision({}));
    expect(missing.status).toBe("invalid");
    expect(
      missing.issues.find(
        (issue) => issue.message === "Select an available text-generation model.",
      ),
    ).toMatchObject({ category: "configuration" });

    const stale = await validator([]).execute(
      revision({
        [SYSTEM_BUILDER_MODEL_BINDING_FIELD_ID]:
          createSystemBuilderModelBinding("model.chat.local"),
      }),
    );
    expect(stale.status).toBe("invalid");
    expect(stale.issues[0]?.message).toBe(
      "The selected model is unavailable in this workspace.",
    );
    expect(
      JSON.stringify(stale.issues).includes("local/chat"),
    ).toBe(false);
  });
});
