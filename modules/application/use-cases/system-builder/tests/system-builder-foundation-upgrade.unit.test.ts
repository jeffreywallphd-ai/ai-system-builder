import type {
  AssetConfigurationValues,
  AssetInstance,
  AssetJsonValue,
} from "../../../../contracts/asset";
import { normalizeAssetId } from "../../../../contracts/asset";
import {
  normalizeSystemBuilderRevisionId,
  normalizeSystemBuilderSystemId,
  type SystemBuilderRecord,
  type SystemBuilderRevision,
} from "../../../../contracts/system-builder";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createStructuredSystemBuilderRepository } from "../../../../adapters/persistence/system-builder";
import { describe, expect, it } from "../../../../testing/node-test";
import {
  SYSTEM_FOUNDATION_PACK_MANIFEST,
  SYSTEM_FOUNDATION_PACK_V2_MANIFEST,
  SYSTEM_FOUNDATION_PACK_V3_MANIFEST,
} from "../../../services/asset-packs/system-packs";
import {
  materializeReferenceSystemTemplateStructure,
  SystemBuilderReferenceTemplateRegistry,
  ValidateSystemBuilderRevisionService,
} from "../../../services/system-builder";
import {
  PreviewSystemBuilderFoundationUpgradeUseCase,
  UpgradeSystemBuilderFoundationUseCase,
} from "../upgrade-system-builder-foundation.use-cases";

const workspaceId = createWorkspaceId("workspace-foundation-upgrade");
const timestamp = "2026-07-20T12:00:00.000Z";
const validator = new ValidateSystemBuilderRevisionService(
  {
    async readExactDefinition(reference) {
      return [
        ...SYSTEM_FOUNDATION_PACK_MANIFEST.assets,
        ...SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets,
        ...SYSTEM_FOUNDATION_PACK_V3_MANIFEST.assets,
      ]
        .map((entry) => entry.definition)
        .find(
          (definition) =>
            String(definition.definitionId) === String(reference.id) &&
            String(definition.version) === String(reference.version),
        );
    },
  },
  () => timestamp,
);

describe("System Builder Foundation upgrade", () => {
  it("previews without writing, then atomically creates v3 while preserving v2", async () => {
    const fixture = await createUpgradeFixture("upgrade-success");
    const previewUseCase = new PreviewSystemBuilderFoundationUpgradeUseCase({
      repository: fixture.repository,
      validator,
      now: () => timestamp,
    });
    const preview = await previewUseCase.execute({
      workspaceId,
      systemId: fixture.record.systemId,
      expectedRecordRevision: 1,
      actorId: "person-1",
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.eligible).toBe(true);
    expect(preview.value.sourceVersion).toBe("2.0.0");
    expect(preview.value.targetVersion).toBe("3.0.0");
    expect(preview.value.validationStatus).toBe("invalid");
    expect(preview.value.issues).toEqual([]);
    expect(
      preview.value.validationIssues.every(
        (issue) => issue.path?.[issue.path.length - 1] === "modelBinding",
      ),
    ).toBe(true);
    expect(preview.value.mappedInstanceCount).toBe(
      fixture.sourceRevision.instances.length,
    );
    expect(
      (
        await fixture.repository.listRevisions(
          workspaceId,
          fixture.record.systemId,
        )
      ).length,
    ).toBe(1);

    const upgraded = await new UpgradeSystemBuilderFoundationUseCase({
      repository: fixture.repository,
      validator,
      now: () => timestamp,
    }).execute({
      workspaceId,
      systemId: fixture.record.systemId,
      expectedRecordRevision: 1,
      sourceRevisionId: preview.value.sourceRevisionId,
      actorId: "person-1",
    });
    expect(upgraded.ok).toBe(true);
    if (!upgraded.ok) return;
    expect(upgraded.value.revisionNumber).toBe(2);
    expect(upgraded.value.structure?.layoutPresetRef?.version).toBe("3.0.0");
    expect(
      upgraded.value.instances.every(
        (instance) =>
          instance.definitionRef.kind !== "asset-definition-version" ||
          instance.definitionRef.version === "3.0.0",
      ),
    ).toBe(true);
    expect(
      upgraded.value.validationIssues.every(
        (issue) => issue.path?.[issue.path.length - 1] === "modelBinding",
      ),
    ).toBe(true);

    const revisions = await fixture.repository.listRevisions(
      workspaceId,
      fixture.record.systemId,
    );
    expect(
      revisions
        .map((revision) => revision.revisionNumber)
        .sort((left, right) => left - right),
    ).toEqual([1, 2]);
    const sourceRevision = revisions.find(
      (revision) => revision.revisionNumber === 1,
    );
    expect(
      sourceRevision?.instances.every(
        (instance) => instance.definitionRef.version === "2.0.0",
      ),
    ).toBe(true);
    expect(sourceRevision?.structure).toBeUndefined();
    expect(
      (
        await fixture.repository.readRecord(
          workspaceId,
          fixture.record.systemId,
        )
      )?.currentRevisionId,
    ).toBe(upgraded.value.revisionId);
    expect(
      (
        await fixture.repository.readRecord(
          workspaceId,
          fixture.record.systemId,
        )
      )?.status,
    ).toBe("blocked");
  });

  it("explicitly upgrades a flat v1 reference while preserving its exact source", async () => {
    const fixture = await createUpgradeFixture("upgrade-v1", false, "1.0.0");
    const dependencies = {
      repository: fixture.repository,
      validator,
      now: () => timestamp,
    };
    const preview = await new PreviewSystemBuilderFoundationUpgradeUseCase(
      dependencies,
    ).execute({
      workspaceId,
      systemId: fixture.record.systemId,
      expectedRecordRevision: 1,
      actorId: "person-1",
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.sourceVersion).toBe("1.0.0");
    expect(preview.value.eligible).toBe(true);

    const upgraded = await new UpgradeSystemBuilderFoundationUseCase(
      dependencies,
    ).execute({
      workspaceId,
      systemId: fixture.record.systemId,
      expectedRecordRevision: 1,
      sourceRevisionId: preview.value.sourceRevisionId,
      actorId: "person-1",
    });
    expect(upgraded.ok).toBe(true);
    if (!upgraded.ok) return;
    expect(
      upgraded.value.validationIssues.every(
        (issue) => issue.path?.[issue.path.length - 1] === "modelBinding",
      ),
    ).toBe(true);
    expect(
      upgraded.value.instances.every(
        (instance) => instance.definitionRef.version === "3.0.0",
      ),
    ).toBe(true);
    const revisions = await fixture.repository.listRevisions(
      workspaceId,
      fixture.record.systemId,
    );
    expect(
      revisions
        .find((revision) => revision.revisionNumber === 1)
        ?.instances.every(
          (instance) => instance.definitionRef.version === "1.0.0",
        ),
    ).toBe(true);
  });

  it("repairs a saved mixed v1/v3 reference hierarchy only through explicit upgrade", async () => {
    const fixture = await createUpgradeFixture(
      "upgrade-v1-structured",
      false,
      "1.0.0",
      true,
    );
    const sourceValidation = await validator.execute(fixture.sourceRevision);
    expect(sourceValidation.status).toBe("invalid");
    expect(
      sourceValidation.issues.some((issue) =>
        issue.message.includes("does not declare"),
      ),
    ).toBe(true);

    const dependencies = {
      repository: fixture.repository,
      validator,
      now: () => timestamp,
    };
    const preview = await new PreviewSystemBuilderFoundationUpgradeUseCase(
      dependencies,
    ).execute({
      workspaceId,
      systemId: fixture.record.systemId,
      expectedRecordRevision: 1,
      actorId: "person-1",
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.sourceVersion).toBe("1.0.0");
    expect(preview.value.validationStatus).toBe("invalid");
    expect(preview.value.eligible).toBe(true);

    const upgraded = await new UpgradeSystemBuilderFoundationUseCase(
      dependencies,
    ).execute({
      workspaceId,
      systemId: fixture.record.systemId,
      expectedRecordRevision: 1,
      sourceRevisionId: preview.value.sourceRevisionId,
      actorId: "person-1",
    });
    expect(upgraded.ok).toBe(true);
    if (!upgraded.ok) return;
    expect(
      upgraded.value.validationIssues.every(
        (issue) => issue.path?.[issue.path.length - 1] === "modelBinding",
      ),
    ).toBe(true);
    expect(upgraded.value.placements?.length).toBeGreaterThan(3);
  });

  it("reports unmapped values and refuses to create a revision", async () => {
    const fixture = await createUpgradeFixture("upgrade-unmapped", true);
    const dependencies = {
      repository: fixture.repository,
      validator,
      now: () => timestamp,
    };
    const preview = await new PreviewSystemBuilderFoundationUpgradeUseCase(
      dependencies,
    ).execute({
      workspaceId,
      systemId: fixture.record.systemId,
      expectedRecordRevision: 1,
      actorId: "person-1",
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.eligible).toBe(false);
    expect(preview.value.issues[0]?.code).toBe(
      "foundation-configuration-field-unmapped",
    );
    expect(preview.value.issues[0]?.fieldId).toBe("legacyOnly");

    const result = await new UpgradeSystemBuilderFoundationUseCase(
      dependencies,
    ).execute({
      workspaceId,
      systemId: fixture.record.systemId,
      expectedRecordRevision: 1,
      sourceRevisionId: preview.value.sourceRevisionId,
      actorId: "person-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(
        "system-builder.foundation-upgrade-blocked",
      );
    }
    expect(
      (
        await fixture.repository.listRevisions(
          workspaceId,
          fixture.record.systemId,
        )
      ).length,
    ).toBe(1);
  });

  it("rejects confirmation when the previewed source revision is stale", async () => {
    const fixture = await createUpgradeFixture("upgrade-stale");
    const result = await new UpgradeSystemBuilderFoundationUseCase({
      repository: fixture.repository,
      validator,
      now: () => timestamp,
    }).execute({
      workspaceId,
      systemId: fixture.record.systemId,
      expectedRecordRevision: 1,
      sourceRevisionId: normalizeSystemBuilderRevisionId(
        `${fixture.record.systemId}.r999`,
      ),
      actorId: "person-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("system-builder.stale");
    }
    expect(
      (
        await fixture.repository.listRevisions(
          workspaceId,
          fixture.record.systemId,
        )
      ).length,
    ).toBe(1);
  });
});

async function createUpgradeFixture(
  suffix: string,
  includeUnmappedField = false,
  sourceVersion: "1.0.0" | "2.0.0" = "2.0.0",
  materializeLegacyStructure = false,
) {
  const systemId = normalizeSystemBuilderSystemId(`system-${suffix}`);
  const materialized = new SystemBuilderReferenceTemplateRegistry().materialize(
    "reference.controlled-chatbot@1.0.0",
    {
      systemId,
      name: "Controlled assistant",
      actorId: "person-1",
      timestamp,
    },
  );
  if (!materialized) throw new Error("Missing reference-system fixture.");
  const instances = materialized.instances.map((instance, index) =>
    downgradeInstance(
      instance,
      includeUnmappedField && index === 0,
      sourceVersion,
    ),
  );
  const composition = {
    ...materialized.composition,
    instanceRefs: instances.map((instance) => ({
      kind: "asset-instance" as const,
      id: normalizeAssetId(String(instance.instanceId)),
    })),
  };
  const source = materializeLegacyStructure
    ? materializeReferenceSystemTemplateStructure({
        systemId: String(systemId),
        name: "Controlled assistant",
        actorId: "person-1",
        timestamp,
        materialized: {
          ...materialized,
          composition,
          instances,
        },
      })
    : { ...materialized, composition, instances };
  const revisionId = normalizeSystemBuilderRevisionId(`${systemId}.r1`);
  const sourceRevision: SystemBuilderRevision = {
    revisionId,
    systemId,
    targetWorkspaceId: workspaceId,
    revisionNumber: 1,
    composition: source.composition,
    instances: source.instances,
    bindings: source.bindings,
    ...(source.structure ? { structure: source.structure } : {}),
    ...(source.placements ? { placements: source.placements } : {}),
    validationIssues: [],
    createdAt: timestamp,
    createdBy: "person-1",
  };
  const systemRootDefinitionRef = source.instances.find(
    (instance) => String(instance.definitionRef.id) === "builtin.system.system",
  )?.definitionRef;
  const record: SystemBuilderRecord = {
    systemId,
    targetWorkspaceId: workspaceId,
    name: "Controlled assistant",
    description: materialized.description,
    status: "validated",
    revision: 1,
    currentRevisionId: revisionId,
    composition: source.composition,
    ...(systemRootDefinitionRef
      ? { systemDefinitionRef: systemRootDefinitionRef }
      : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: "person-1",
    updatedBy: "person-1",
  };
  const repository = createStructuredSystemBuilderRepository(
    createInMemoryStructuredDocumentStore(),
  );
  await repository.createRecordAndRevision(record, sourceRevision);
  return { repository, record, sourceRevision };
}

function downgradeInstance(
  instance: AssetInstance,
  includeUnmappedField: boolean,
  sourceVersion: "1.0.0" | "2.0.0",
): AssetInstance {
  const sourceManifest =
    sourceVersion === "1.0.0"
      ? SYSTEM_FOUNDATION_PACK_MANIFEST
      : SYSTEM_FOUNDATION_PACK_V2_MANIFEST;
  const definition = sourceManifest.assets.find(
    (entry) =>
      String(entry.definition.definitionId) ===
      String(instance.definitionRef.id),
  )?.definition;
  if (!definition) throw new Error("Missing v2 Foundation definition.");
  const acceptedFields = new Set(
    definition.configurationSchema?.fields.map((field) => field.fieldId) ?? [],
  );
  const selectedConfiguration: Record<string, AssetJsonValue> = {
    ...(definition.defaultConfiguration ?? {}),
  };
  for (const [fieldId, value] of Object.entries(
    instance.selectedConfiguration ?? {},
  )) {
    if (acceptedFields.has(fieldId)) {
      selectedConfiguration[fieldId] = downgradeValue(value);
    }
  }
  if (includeUnmappedField) {
    selectedConfiguration.legacyOnly = "must-not-be-dropped";
  }
  return {
    ...instance,
    definitionRef: {
      ...instance.definitionRef,
      version: sourceVersion,
    },
    selectedConfiguration: selectedConfiguration as AssetConfigurationValues,
  };
}

function downgradeValue(value: AssetJsonValue): AssetJsonValue {
  if (Array.isArray(value)) return value.map(downgradeValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Readonly<Record<string, AssetJsonValue>>;
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [
      key,
      key === "version" &&
      record.kind === "asset-definition-version" &&
      entry === "3.0.0"
        ? "2.0.0"
        : downgradeValue(entry),
    ]),
  );
}
