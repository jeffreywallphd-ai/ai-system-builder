import { describe, expect, it } from "../../../../testing/node-test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createStructuredSystemBuilderRepository } from "../../../../adapters/persistence/system-builder";
import type {
  AssetInstance,
  AssetPlacement,
  AssetReference,
} from "../../../../contracts/asset";
import {
  ASSET_PLACEMENT_SCHEMA_VERSION,
  normalizeAssetId,
  normalizeAssetSlotId,
} from "../../../../contracts/asset";
import { createWorkspaceId } from "../../../../contracts/workspace";
import {
  exactSystemFoundationDefinitionReference,
  SYSTEM_FOUNDATION_PACK_MANIFEST,
  SYSTEM_FOUNDATION_PACK_V2_MANIFEST,
} from "../../../services/asset-packs/system-packs";
import { ValidateSystemBuilderRevisionService } from "../../../services/system-builder";
import {
  CreateSystemBuilderSystemUseCase,
  CreateSystemBuilderFromTemplateUseCase,
  PreviewSystemBuilderLayoutChangeUseCase,
} from "../index";
import { SystemBuilderReferenceTemplateRegistry } from "../../../services/system-builder";

const workspaceId = createWorkspaceId("workspace-layout-change");
const timestamp = "2026-07-19T00:00:00.000Z";

describe("System Builder layout change preview", () => {
  it("deterministically preserves compatible content and exposes unmatched content without persistence", async () => {
    const repository = createStructuredSystemBuilderRepository(
      createInMemoryStructuredDocumentStore(),
    );
    const definitions = definitionReader();
    const validator = new ValidateSystemBuilderRevisionService(
      definitions,
      () => timestamp,
    );
    const dependencies = {
      repository,
      validator,
      generateSystemId: () => "system-layout-change",
      now: () => timestamp,
    };
    const created = await new CreateSystemBuilderSystemUseCase(
      dependencies,
    ).execute({
      workspaceId,
      name: "Layout change",
      actorId: "user-1",
      layoutPresetRef: exactSystemFoundationDefinitionReference(
        "builtin.layout.application.navigation",
      ),
    });
    if (!created.ok) throw new Error(created.error.message);
    const [revision] = await repository.listRevisions(
      workspaceId,
      created.value.systemId,
    );
    if (!revision?.structure || !revision.placements) {
      throw new Error("Missing source structure.");
    }
    const shellPlacement = revision.placements.find(
      (placement) => String(placement.slotId) === "application-shell",
    );
    if (!shellPlacement) throw new Error("Missing application shell.");
    const emptyStateRef = exactSystemFoundationDefinitionReference(
      "builtin.state.empty-state",
    );
    const additions = [
      extraInstance("extra-top", "Top content", emptyStateRef, revision),
      extraInstance("extra-side", "Side content", emptyStateRef, revision),
    ];
    const placements = [
      ...revision.placements,
      extraPlacement(
        "extra-top-placement",
        shellPlacement.childInstanceRef,
        "top-bar",
        additions[0]!,
      ),
      extraPlacement(
        "extra-side-placement",
        shellPlacement.childInstanceRef,
        "start-sidebar",
        additions[1]!,
      ),
    ];
    const previewUseCase = new PreviewSystemBuilderLayoutChangeUseCase({
      repository,
      definitions,
      validator,
    });
    const command = {
      workspaceId,
      actorId: "user-1",
      systemId: created.value.systemId,
      expectedRecordRevision: 1,
      targetLayoutPresetRef: exactSystemFoundationDefinitionReference(
        "builtin.layout.application.minimal",
      ),
      composition: revision.composition,
      instances: [...revision.instances, ...additions],
      bindings: revision.bindings,
      structure: revision.structure,
      placements,
    };

    const first = await previewUseCase.execute(command);
    const second = await previewUseCase.execute(command);

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.instances.length).toBe(revision.instances.length + 2);
    expect(
      first.value.unassignedInstanceRefs.map((item) => String(item.id)),
    ).toEqual(["extra-top", "extra-side"]);
    expect(
      first.value.changes.some(
        (item) =>
          item.disposition === "preserved" && item.toSlotId === "content",
      ),
    ).toBe(true);
    expect(
      first.value.instances.find(
        (item) =>
          String(item.instanceId) ===
          String(shellPlacement.childInstanceRef.id),
      )?.definitionRef.id,
    ).toBe("builtin.layout.application.minimal");
    expect(first.value.structure.layoutPresetRef?.id).toBe(
      "builtin.layout.application.minimal",
    );
    expect(
      first.value.validationIssues.some((issue) =>
        /placement parent/i.test(issue.message),
      ),
    ).toBe(true);
    expect(
      (await repository.listRevisions(workspaceId, created.value.systemId))
        .length,
    ).toBe(1);
  });

  it("rejects stale previews before remapping draft content", async () => {
    const repository = createStructuredSystemBuilderRepository(
      createInMemoryStructuredDocumentStore(),
    );
    const definitions = definitionReader();
    const validator = new ValidateSystemBuilderRevisionService(definitions);
    const created = await new CreateSystemBuilderSystemUseCase({
      repository,
      validator,
      generateSystemId: () => "system-stale-layout",
    }).execute({ workspaceId, name: "Stale", actorId: "user-1" });
    if (!created.ok) throw new Error(created.error.message);
    const [revision] = await repository.listRevisions(
      workspaceId,
      created.value.systemId,
    );
    if (!revision?.structure || !revision.placements) throw new Error();
    const result = await new PreviewSystemBuilderLayoutChangeUseCase({
      repository,
      definitions,
      validator,
    }).execute({
      workspaceId,
      actorId: "user-1",
      systemId: created.value.systemId,
      expectedRecordRevision: 0,
      targetLayoutPresetRef: exactSystemFoundationDefinitionReference(
        "builtin.layout.application.minimal",
      ),
      composition: revision.composition,
      instances: revision.instances,
      bindings: revision.bindings,
      structure: revision.structure,
      placements: revision.placements,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("system-builder.stale");
  });

  it("materializes a selected layout for a legacy built-in reference system without deleting its assets", async () => {
    const repository = createStructuredSystemBuilderRepository(
      createInMemoryStructuredDocumentStore(),
    );
    const definitions = definitionReader();
    const validator = new ValidateSystemBuilderRevisionService(
      definitions,
      () => timestamp,
    );
    const dependencies = {
      repository,
      validator,
      generateSystemId: () => "system-controlled-chatbot-layout",
      now: () => timestamp,
    };
    const created = await new CreateSystemBuilderFromTemplateUseCase(
      dependencies,
      new SystemBuilderReferenceTemplateRegistry(),
    ).execute({
      workspaceId,
      actorId: "user-1",
      templateId: "reference.controlled-chatbot@1.0.0",
      name: "Controlled chatbot",
    });
    if (!created.ok) throw new Error(created.error.message);
    const [revision] = await repository.listRevisions(
      workspaceId,
      created.value.systemId,
    );
    if (!revision) throw new Error("Missing reference revision.");
    expect(revision.structure).toBeUndefined();

    const result = await new PreviewSystemBuilderLayoutChangeUseCase({
      repository,
      definitions,
      validator,
      now: () => timestamp,
    }).execute({
      workspaceId,
      actorId: "user-1",
      systemId: created.value.systemId,
      expectedRecordRevision: created.value.revision,
      targetLayoutPresetRef: exactSystemFoundationDefinitionReference(
        "builtin.layout.application.standard",
      ),
      composition: revision.composition,
      instances: revision.instances,
      bindings: revision.bindings,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.structure.layoutPresetRef?.id).toBe(
      "builtin.layout.application.standard",
    );
    expect(
      result.value.instances.find(
        (instance) =>
          String(instance.instanceId) ===
          String(revision.composition.rootInstanceRefs[0]?.id),
      )?.definitionRef,
    ).toMatchObject({ id: "builtin.system.system", version: "2.0.0" });
    expect(
      result.value.placements.some(
        (placement) => String(placement.slotId) === "application-shell",
      ),
    ).toBe(true);
    expect(result.value.unassignedInstanceRefs.length).toBeGreaterThan(0);
    expect(
      result.value.unassignedInstanceRefs.length <
        revision.instances.length - 1,
    ).toBe(true);
    expect(
      result.value.placements.some(
        (placement) =>
          String(placement.parentInstanceRef.id).endsWith(".starter") &&
          String(placement.slotId) === "interface" &&
          String(placement.childInstanceRef.id).endsWith(".chat-shell"),
      ),
    ).toBe(true);
    expect(
      result.value.placements.some(
        (placement) =>
          String(placement.parentInstanceRef.id).endsWith(".composer") &&
          String(placement.slotId) === "actions" &&
          String(placement.childInstanceRef.id).endsWith(".visual-send"),
      ),
    ).toBe(true);
    expect(
      result.value.validationIssues
        .filter((issue) =>
          issue.message.includes(
            "selected child definition is not compatible with this slot",
          ),
        )
        .map((issue) => {
          const placementId = issue.path?.[1];
          const placement = result.value.placements.find(
            (candidate) => String(candidate.placementId) === placementId,
          );
          return placement
            ? `${placement.parentInstanceRef.id}.${placement.slotId}->${placement.childInstanceRef.id}`
            : String(placementId);
        }),
    ).toEqual([]);
    expect(
      result.value.instances
        .filter((instance) =>
          String(instance.instanceId).startsWith(
            String(created.value.systemId) + ".",
          ),
        )
        .every((instance) => instance.definitionRef.version === "2.0.0"),
    ).toBe(true);
    expect(result.value.instances.length).toBeGreaterThan(
      revision.instances.length,
    );
    expect(
      (await repository.listRevisions(workspaceId, created.value.systemId))
        .length,
    ).toBe(1);
  });
});

function definitionReader() {
  const definitions = [
    ...SYSTEM_FOUNDATION_PACK_MANIFEST.assets,
    ...SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets,
  ].map((entry) => entry.definition);
  return {
    readExactDefinition: async (reference: AssetReference) =>
      definitions.find(
        (candidate) =>
          String(candidate.definitionId) === String(reference.id) &&
          candidate.version === reference.version,
      ),
  };
}

function extraInstance(
  id: string,
  displayName: string,
  definitionRef: AssetReference,
  revision: { readonly composition: { readonly compositionId: string } },
): AssetInstance {
  return {
    instanceId: normalizeAssetId(id),
    definitionRef,
    displayName,
    lifecycleStatus: "draft",
    selectedConfiguration: {},
    parentCompositionRef: {
      kind: "asset-composition",
      id: normalizeAssetId(String(revision.composition.compositionId)),
    },
    provenance: { sourceKind: "human-authored", createdBy: "user-1" },
  };
}

function extraPlacement(
  id: string,
  parentInstanceRef: AssetReference,
  slotId: string,
  child: AssetInstance,
): AssetPlacement {
  return {
    schemaVersion: ASSET_PLACEMENT_SCHEMA_VERSION,
    placementId: normalizeAssetId(id),
    parentInstanceRef,
    slotId: normalizeAssetSlotId(slotId),
    childInstanceRef: { kind: "asset-instance", id: child.instanceId },
    order: 0,
    provenance: { sourceKind: "human-authored" },
  };
}
