import { describe, expect, it } from "../../../../testing/node-test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createStructuredSystemBuilderRepository } from "../../../../adapters/persistence/system-builder";
import {
  normalizeAssetId,
  type AssetInstance,
} from "../../../../contracts/asset";
import { createWorkspaceId } from "../../../../contracts/workspace";
import {
  createSystemBuilderModelBinding,
  readSystemBuilderConversationInteraction,
  SYSTEM_BUILDER_MODEL_BINDING_FIELD_ID,
  type SystemBuilderValidationResult,
} from "../../../../contracts/system-builder";
import {
  ArchiveSystemBuilderSystemUseCase,
  CloneSystemBuilderSystemUseCase,
  CreateSystemBuilderSystemUseCase,
  ListSystemBuilderSystemsUseCase,
  ReadSystemBuilderRevisionUseCase,
  RestoreSystemBuilderSystemUseCase,
  SaveSystemBuilderRevisionUseCase,
} from "../system-builder-use-cases";

const workspaceId = createWorkspaceId("workspace-one");
const valid: SystemBuilderValidationResult = {
  status: "valid",
  issues: [],
  validatedAt: "2026-07-17T00:00:00.000Z",
};

describe("System Builder use cases", () => {
  it("creates workspace-scoped records and immutable initial revisions", async () => {
    const repository = createStructuredSystemBuilderRepository(
      createInMemoryStructuredDocumentStore(),
    );
    const create = new CreateSystemBuilderSystemUseCase({
      repository,
      validator: { execute: async () => valid },
      generateSystemId: () => "system-one",
      now: () => "2026-07-17T00:00:00.000Z",
    });
    const created = await create.execute({
      workspaceId,
      name: "  Customer portal  ",
      actorId: "user-1",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.name).toBe("Customer portal");
    expect(created.value.revision).toBe(1);
    expect(
      (await repository.listRecords(createWorkspaceId("workspace-two"))).length,
    ).toBe(0);
    const revisions = await repository.listRevisions(
      workspaceId,
      created.value.systemId,
    );
    expect(revisions.map((item) => item.revisionNumber)).toEqual([1]);
    expect(revisions[0]?.structure?.profile).toBe("interactive");
    expect(revisions[0]?.instances.length).toBe(4);
    expect(revisions[0]?.placements?.length).toBe(3);
  });

  it("saves canonical revisions atomically and rejects stale updates", async () => {
    const repository = createStructuredSystemBuilderRepository(
      createInMemoryStructuredDocumentStore(),
    );
    const dependencies = {
      repository,
      validator: { execute: async () => valid },
      generateSystemId: () => "system-save",
      now: () => "2026-07-17T00:00:00.000Z",
    };
    const created = await new CreateSystemBuilderSystemUseCase(
      dependencies,
    ).execute({ workspaceId, name: "Save test", actorId: "user-1" });
    if (!created.ok) throw new Error(created.error.message);
    const [initialRevision] = await repository.listRevisions(
      workspaceId,
      created.value.systemId,
    );
    if (!initialRevision) throw new Error("Missing initial revision.");
    const input = {
      workspaceId,
      systemId: created.value.systemId,
      expectedRecordRevision: 1,
      actorId: "user-1",
      composition: created.value.composition,
      instances: initialRevision.instances,
      bindings: initialRevision.bindings,
      structure: initialRevision.structure,
      placements: initialRevision.placements,
    };
    const save = new SaveSystemBuilderRevisionUseCase(dependencies);
    const saved = await save.execute(input);
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.value.structure).toEqual(initialRevision.structure);
      expect(saved.value.placements).toEqual(initialRevision.placements);
    }
    expect(
      (await repository.readRecord(workspaceId, created.value.systemId))
        ?.revision,
    ).toBe(2);
    const stale = await save.execute(input);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe("system-builder.stale");
    expect(
      (await repository.listRevisions(workspaceId, created.value.systemId))
        .length,
    ).toBe(2);
  });

  it("restores the canonical persisted-history interaction when saving an unambiguous chatbot reference", async () => {
    const repository = createStructuredSystemBuilderRepository(
      createInMemoryStructuredDocumentStore(),
    );
    const dependencies = {
      repository,
      validator: { execute: async () => valid },
      generateSystemId: () => "system-chat-repair",
      now: () => "2026-07-29T00:00:00.000Z",
    };
    const created = await new CreateSystemBuilderSystemUseCase(
      dependencies,
    ).execute({ workspaceId, name: "Chat repair", actorId: "user-1" });
    if (!created.ok) throw new Error(created.error.message);
    const conversationInstance = (
      suffix: string,
      definitionId: string,
      selectedConfiguration: AssetInstance["selectedConfiguration"] = {},
    ): AssetInstance => ({
      instanceId: normalizeAssetId(`system-chat-repair.${suffix}`),
      definitionRef: {
        kind: "asset-definition-version",
        id: normalizeAssetId(definitionId),
        version: "3.0.0",
      },
      lifecycleStatus: "draft",
      selectedConfiguration,
      parentCompositionRef: {
        kind: "asset-composition",
        id: created.value.composition.compositionId,
      },
      provenance: { sourceKind: "system-generated" },
      metadata: { referenceSystemKind: "controlled-chatbot" },
    });
    const composer = conversationInstance(
      "composer",
      "conversation.message-composer",
      {
        [SYSTEM_BUILDER_MODEL_BINDING_FIELD_ID]:
          createSystemBuilderModelBinding("model.chat.local"),
      },
    );
    const history = conversationInstance(
      "history-display",
      "conversation.message-history-display",
    );
    const instances = [composer, history];
    const instanceRefs = instances.map((instance) => ({
      kind: "asset-instance" as const,
      id: instance.instanceId,
    }));

    const saved = await new SaveSystemBuilderRevisionUseCase(
      dependencies,
    ).execute({
      workspaceId,
      systemId: created.value.systemId,
      expectedRecordRevision: 1,
      actorId: "user-1",
      composition: {
        ...created.value.composition,
        rootInstanceRefs: instanceRefs,
        instanceRefs,
        bindingRefs: [],
      },
      instances,
      bindings: [],
    });

    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.bindings.length).toBe(1);
    expect(saved.value.composition.bindingRefs.length).toBe(1);
    expect(
      readSystemBuilderConversationInteraction(saved.value.bindings[0]!),
    ).toEqual({
      schemaVersion: "1.0",
      kind: "conversation-turn",
      composerInstanceId: "system-chat-repair.composer",
      historyInstanceId: "system-chat-repair.history-display",
      transcriptMode: "persisted-only",
    });
  });

  it("archives, restores, clones, and preserves canonical structure without mutating its source", async () => {
    const repository = createStructuredSystemBuilderRepository(
      createInMemoryStructuredDocumentStore(),
    );
    let id = 0;
    const dependencies = {
      repository,
      validator: { execute: async () => valid },
      generateSystemId: () => `system-${++id}`,
      now: () => "2026-07-17T00:00:00.000Z",
    };
    const created = await new CreateSystemBuilderSystemUseCase(
      dependencies,
    ).execute({ workspaceId, name: "Source", actorId: "user-1" });
    if (!created.ok) throw new Error(created.error.message);
    const [sourceRevision] = await repository.listRevisions(
      workspaceId,
      created.value.systemId,
    );
    if (!sourceRevision) throw new Error("Missing source revision.");
    const archived = await new ArchiveSystemBuilderSystemUseCase(
      dependencies,
    ).execute({
      workspaceId,
      systemId: created.value.systemId,
      expectedRevision: 1,
      actorId: "user-1",
    });
    expect(archived.ok && archived.value.status).toBe("archived");
    if (!archived.ok) return;
    const restored = await new RestoreSystemBuilderSystemUseCase(
      dependencies,
    ).execute({
      workspaceId,
      systemId: archived.value.systemId,
      expectedRevision: 2,
      actorId: "user-1",
    });
    expect(restored.ok && restored.value.status).toBe("validated");
    const cloned = await new CloneSystemBuilderSystemUseCase(
      dependencies,
    ).execute({
      workspaceId,
      sourceSystemId: created.value.systemId,
      name: "Clone",
      actorId: "user-1",
    });
    expect(cloned.ok).toBe(true);
    if (!cloned.ok) return;
    expect(cloned.value.systemId).not.toBe(created.value.systemId);
    const cloneRevision = await new ReadSystemBuilderRevisionUseCase(
      repository,
    ).execute({ workspaceId, systemId: cloned.value.systemId });
    expect(
      cloneRevision.ok && cloneRevision.value.composition.displayName,
    ).toBe("Clone");
    expect(cloneRevision.ok && cloneRevision.value.structure).toEqual(
      sourceRevision.structure,
    );
    expect(cloneRevision.ok && cloneRevision.value.placements).toEqual(
      sourceRevision.placements,
    );
    expect(
      (
        await new ListSystemBuilderSystemsUseCase(repository).execute({
          workspaceId,
        })
      )
        .map((item) => item.name)
        .sort(),
    ).toEqual(["Clone", "Source"]);
  });
});
