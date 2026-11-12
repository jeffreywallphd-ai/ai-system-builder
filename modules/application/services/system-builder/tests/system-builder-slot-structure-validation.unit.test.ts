import { describe, expect, it } from "../../../../testing/node-test";

import type {
  AssetDefinition,
  AssetReference,
} from "../../../../contracts/asset";
import { normalizeAssetId, normalizeAssetSlotId } from "../../../../contracts/asset";
import type {
  SystemBuilderComposition,
  SystemBuilderRevision,
} from "../../../../contracts/system-builder";
import {
  normalizeSystemBuilderRevisionId,
  normalizeSystemBuilderSystemId,
  minimumSystemBuilderSlotItems,
  SYSTEM_FORM_PLACEMENT_MESSAGE,
} from "../../../../contracts/system-builder";
import { createWorkspaceId } from "../../../../contracts/workspace";
import {
  exactSystemFoundationDefinitionReference,
  SYSTEM_FOUNDATION_APPLICATION_LAYOUT_IDS,
  SYSTEM_FOUNDATION_CURRENT_PACK_MANIFEST,
} from "../../asset-packs/system-packs";
import { createCanonicalSystemBuilderStructure } from "../create-canonical-system-builder-structure.service";
import {
  MAX_SYSTEM_BUILDER_INSTANCES,
  ValidateSystemBuilderRevisionService,
} from "../validate-system-builder-revision.service";
import { systemBuilderSlotAcceptsDefinition } from "../validate-system-builder-structure.service";

const timestamp = "2026-07-18T00:00:00.000Z";
const systemId = normalizeSystemBuilderSystemId("system-slot-test");
const compositionId = "system-slot-test.composition";

describe("canonical System Builder slot structure", () => {
  it("creates and validates a root, shell and empty page without seeding a content asset", async () => {
    const revision = createRevision();
    const result = await validator().execute(revision);

    expect(result.status).toBe("valid");
    expect(result.issues).toEqual([]);
    expect(revision.structure?.profile).toBe("interactive");
    expect(revision.structure?.layoutPresetRef?.id).toBe(
      "builtin.layout.application.minimal",
    );
    expect(revision.composition.rootInstanceRefs.length).toBe(1);
    expect(revision.instances.map((item) => String(item.definitionRef.id))).toEqual([
      "builtin.system.system",
      "builtin.layout.application.minimal",
      "builtin.layout.page.single",
    ]);
    expect(revision.placements?.length).toBe(2);
    expect(revision.composition.placementRefs?.length).toBe(2);
    const shellPlacement = revision.placements?.find(
      (placement) => String(placement.slotId) === "application-shell",
    );
    expect(
      revision.instances.find(
        (instance) =>
          String(instance.instanceId) ===
          String(shellPlacement?.childInstanceRef.id),
      )?.definitionRef.id,
    ).toBe("builtin.layout.application.minimal");
  });

  it("keeps historical and custom slot minima while allowing the exact interactive Foundation page to be empty", () => {
    const page = exactSystemFoundationDefinitionReference("builtin.layout.page.single");
    const content = definition("builtin.layout.page.single").slots![0]!;
    expect(content.cardinality.minItems).toBe(1);
    expect(minimumSystemBuilderSlotItems("interactive", page, content)).toBe(0);
    expect(minimumSystemBuilderSlotItems("workflow", page, content)).toBe(1);
    expect(minimumSystemBuilderSlotItems("interactive", { ...page, version: "2.0.0" }, content)).toBe(1);
    expect(minimumSystemBuilderSlotItems("interactive", { ...page, id: normalizeAssetId("workspace.custom-page") }, content)).toBe(1);
  });

  it("creates a valid required structure for every approved application layout", async () => {
    for (const layoutId of SYSTEM_FOUNDATION_APPLICATION_LAYOUT_IDS) {
      const revision = createRevision(
        exactSystemFoundationDefinitionReference(layoutId),
      );
      const result = await validator().execute(revision);
      expect(
        result.issues.filter((issue) => issue.severity === "error"),
      ).toEqual([]);
    }
  });

  it("keeps optional visual assets and nonvisual resources valid while unassigned", async () => {
    const revision = createRevision();
    const extras = ["builtin.ui.card", "builtin.data.entity"].map(
      (definitionId, index) => {
        const asset = definition(definitionId);
        return {
          ...revision.instances[0]!,
          instanceId: normalizeAssetId(`unassigned-${index + 1}`),
          definitionRef: exactReference(asset),
          displayName: asset.displayName,
          selectedConfiguration: asset.defaultConfiguration,
        };
      },
    );
    const revised: SystemBuilderRevision = {
      ...revision,
      instances: [...revision.instances, ...extras],
      composition: {
        ...revision.composition,
        instanceRefs: [
          ...revision.composition.instanceRefs,
          ...extras.map((instance) => instanceReference(instance.instanceId)),
        ],
      },
    };

    const result = await validator().execute(revised);

    expect(result.status).toBe("valid");
    expect(result.issues).toEqual([]);
  });

  it("accepts visual assets inside the current Card regions and rejects nonvisual system data", () => {
    const card = definition("builtin.ui.card");
    const table = definition("builtin.display.table");
    const form = definition("builtin.form.form");
    const action = definition("builtin.form.submit-action");
    const entity = definition("builtin.data.entity");
    const page = definition("builtin.shell.page");
    const assistant = definition("conversation.basic-assistant-system");
    const content = card.slots?.find((slot) => slot.slotId === "content");
    const actions = card.slots?.find((slot) => slot.slotId === "actions");
    const pageContent = page.slots?.find((slot) => slot.slotId === "content");
    if (!content || !actions || !pageContent)
      throw new Error("Current Card slots are missing.");

    expect(systemBuilderSlotAcceptsDefinition(content, table)).toBe(true);
    expect(systemBuilderSlotAcceptsDefinition(content, form)).toBe(true);
    expect(systemBuilderSlotAcceptsDefinition(actions, action, card)).toBe(false);
    const formActions = form.slots!.find((slot) => slot.slotId === "actions")!;
    expect(systemBuilderSlotAcceptsDefinition(formActions, action, form)).toBe(true);
    expect(systemBuilderSlotAcceptsDefinition(content, entity)).toBe(false);
    expect(
      systemBuilderSlotAcceptsDefinition(pageContent, assistant, page),
    ).toBe(true);
    expect(systemBuilderSlotAcceptsDefinition(pageContent, assistant)).toBe(
      false,
    );
    expect(systemBuilderSlotAcceptsDefinition(content, assistant, card)).toBe(
      false,
    );
  });

  it("rejects standalone form elements and a field group outside a form", async () => {
    const revision = createRevision();
    const page = revision.instances.find((item) => item.definitionRef.id === "builtin.layout.page.single")!;
    const group = instanceReference("instance.group");
    const field = instanceReference("instance.field");
    const orphan = instanceReference("instance.orphan");
    const instances = [
      ...revision.instances,
      ...([
        [group, "builtin.form.field-group"],
        [field, "builtin.form.text-field"],
        [orphan, "builtin.form.checkbox-field"],
      ] as const).map(([ref, id]) => ({
        ...page, instanceId: ref.id,
        definitionRef: exactReference(definition(id)),
      })),
    ];
    const groupPlacement = {
      schemaVersion: "asset-placement.v1" as const, placementId: "placement.group",
      parentInstanceRef: instanceReference(String(page.instanceId)), childInstanceRef: group,
      slotId: normalizeAssetSlotId("content"), order: 0,
    };
    const fieldPlacement = {
      ...groupPlacement, placementId: "placement.field", parentInstanceRef: group,
      childInstanceRef: field, slotId: normalizeAssetSlotId("fields"),
    };
    const result = await validator().execute({
      ...revision,
      instances,
      placements: [...revision.placements!, groupPlacement, fieldPlacement],
      composition: {
        ...revision.composition,
        instanceRefs: [...revision.composition.instanceRefs, group, field, orphan],
        placementRefs: [...revision.composition.placementRefs!,
          { kind: "asset-placement", id: normalizeAssetId(groupPlacement.placementId) },
          { kind: "asset-placement", id: normalizeAssetId(fieldPlacement.placementId) }],
      },
    });
    expect(result.status).toBe("invalid");
    expect(result.issues.filter((issue) => issue.message === SYSTEM_FORM_PLACEMENT_MESSAGE).map((issue) => issue.path)).toEqual([
      ["instances", "instance.group"], ["instances", "instance.field"], ["instances", "instance.orphan"],
    ]);
  });

  it("accepts an explicitly derived protected root", async () => {
    const revision = clone(createRevision());
    const root = revision.instances[0]!;
    const foundationRoot = definition("builtin.system.system");
    const derivedRoot: AssetDefinition = {
      ...clone(foundationRoot),
      definitionId: normalizeAssetId("workspace.system.custom-root"),
      version: "1.0.0",
      provenance: {
        ...foundationRoot.provenance,
        derivedFromRefs: [
          exactSystemFoundationDefinitionReference("builtin.system.system"),
        ],
      },
    };
    const revised: SystemBuilderRevision = {
      ...revision,
      instances: [
        {
          ...root,
          definitionRef: exactReference(derivedRoot),
        },
        ...revision.instances.slice(1),
      ],
    };
    const result = await validator([derivedRoot]).execute(revised);
    expect(result.status).toBe("valid");
  });

  it("keeps historical flat revisions readable without synthesizing structure", async () => {
    const canonical = createRevision();
    const legacy: SystemBuilderRevision = {
      ...canonical,
      composition: {
        ...canonical.composition,
        placementRefs: undefined,
      },
      structure: undefined,
      placements: undefined,
    };
    const before = JSON.stringify(legacy);
    const result = await validator().execute(legacy);

    expect(result.status).toBe("valid");
    expect(JSON.stringify(legacy)).toBe(before);
    expect(legacy.structure).toBeUndefined();
    expect(legacy.placements).toBeUndefined();
  });

  it("rejects missing roots, unknown slots, incompatible children, gaps, missing required regions, and layout mismatches", async () => {
    const cases: readonly [string, SystemBuilderRevision, RegExp][] = [
      [
        "missing root",
        mutate((revision) => ({
          ...revision,
          composition: { ...revision.composition, rootInstanceRefs: [] },
        })),
        /exactly one protected system root/i,
      ],
      [
        "unknown slot",
        mutate((revision) => ({
          ...revision,
          placements: revision.placements?.map((placement, index) =>
            index === 0
              ? { ...placement, slotId: "missing-slot" as never }
              : placement,
          ),
        })),
        /does not declare/i,
      ],
      [
        "incompatible child",
        mutate((revision) => ({
          ...revision,
          instances: revision.instances.map((instance, index) =>
            index === 1
              ? {
                  ...instance,
                  definitionRef: exactSystemFoundationDefinitionReference(
                    "builtin.state.empty-state",
                  ),
                }
              : instance,
          ),
        })),
        /not compatible|must match/i,
      ],
      [
        "order gap",
        mutate((revision) => ({
          ...revision,
          placements: revision.placements?.map((placement, index) =>
            index === 1 ? { ...placement, order: 1 } : placement,
          ),
        })),
        /contiguous from zero/i,
      ],
      [
        "missing required region",
        mutate((revision) => ({
          ...revision,
          placements: revision.placements?.slice(0, -1),
          composition: {
            ...revision.composition,
            placementRefs: revision.composition.placementRefs?.slice(0, -1),
          },
        })),
        /requires 1 to/i,
      ],
      [
        "layout mismatch",
        mutate((revision) => ({
          ...revision,
          structure: revision.structure
            ? {
                ...revision.structure,
                layoutPresetRef: exactSystemFoundationDefinitionReference(
                  "builtin.layout.application.navigation",
                ),
              }
            : undefined,
        })),
        /must match the revision layout preset/i,
      ],
    ];

    for (const [label, revision, expected] of cases) {
      const result = await validator().execute(revision);
      expect(result.status).toBe("invalid");
      expect(result.issues.some((issue) => expected.test(issue.message))).toBe(
        true,
      );
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("rejects placement cycles with bounded safe diagnostics", async () => {
    const revision = mutate((candidate) => {
      const page = candidate.instances[2]!;
      const placements = candidate.placements?.map((placement, index) =>
        index === 0
          ? {
              ...placement,
              parentInstanceRef: instanceReference(page.instanceId),
            }
          : placement,
      );
      return { ...candidate, placements };
    });
    const result = await validator().execute(revision);
    expect(result.status).toBe("invalid");
    expect(
      result.issues.some((issue) => /containment cycle/i.test(issue.message)),
    ).toBe(true);
    expect(result.issues.length < 201).toBe(true);
  });

  it("rejects oversized revisions before reading definitions", async () => {
    const base = createRevision();
    const instances = Array.from(
      { length: MAX_SYSTEM_BUILDER_INSTANCES + 1 },
      (_, index) => ({
        ...base.instances[0]!,
        instanceId: normalizeAssetId(`oversized-${index}`),
      }),
    );
    const revision: SystemBuilderRevision = {
      ...base,
      instances,
      composition: {
        ...base.composition,
        instanceRefs: instances.map((instance) =>
          instanceReference(String(instance.instanceId)),
        ),
      },
    };
    let definitionReads = 0;
    const result = await new ValidateSystemBuilderRevisionService({
      readExactDefinition: async () => {
        definitionReads += 1;
        return undefined;
      },
    }).execute(revision);
    expect(result.status).toBe("invalid");
    expect(result.issues.length).toBe(1);
    expect(result.issues[0]?.message).toMatch(/at most 513 instances/i);
    expect(definitionReads).toBe(0);
  });
});

function createRevision(
  layoutPresetRef?: AssetReference,
): SystemBuilderRevision {
  const seed = createCanonicalSystemBuilderStructure({
    systemId,
    compositionId,
    name: "Slot test",
    actorId: "user-1",
    timestamp,
    profile: "interactive",
    layoutPresetRef,
  });
  const composition: SystemBuilderComposition = {
    compositionId,
    compositionType: "system",
    displayName: "Slot test",
    version: "0.1.0",
    lifecycleStatus: "draft",
    rootInstanceRefs: seed.rootInstanceRefs,
    instanceRefs: seed.instanceRefs,
    bindingRefs: [],
    placementRefs: seed.placementRefs,
    provenance: { sourceKind: "human-authored" },
  };
  return {
    revisionId: normalizeSystemBuilderRevisionId("system-slot-test.r1"),
    systemId,
    targetWorkspaceId: createWorkspaceId("workspace-slot-test"),
    revisionNumber: 1,
    composition,
    instances: seed.instances,
    bindings: [],
    structure: seed.structure,
    placements: seed.placements,
    validationIssues: [],
    createdAt: timestamp,
    createdBy: "user-1",
  };
}

function mutate(
  change: (revision: SystemBuilderRevision) => SystemBuilderRevision,
): SystemBuilderRevision {
  return change(clone(createRevision()));
}

function validator(
  additional: readonly AssetDefinition[] = [],
): ValidateSystemBuilderRevisionService {
  const definitions = [
    ...SYSTEM_FOUNDATION_CURRENT_PACK_MANIFEST.assets.map(
      (entry) => entry.definition,
    ),
    ...additional,
  ];
  return new ValidateSystemBuilderRevisionService(
    {
      readExactDefinition: async (reference) =>
        definitions.find(
          (candidate) =>
            String(candidate.definitionId) === String(reference.id) &&
            candidate.version === reference.version,
        ),
    },
    () => timestamp,
  );
}

function definition(definitionId: string): AssetDefinition {
  const result = SYSTEM_FOUNDATION_CURRENT_PACK_MANIFEST.assets.find(
    (entry) => String(entry.definition.definitionId) === definitionId,
  )?.definition;
  if (!result) throw new Error("Missing test definition.");
  return result;
}

function exactReference(definitionValue: AssetDefinition): AssetReference {
  return {
    kind: "asset-definition-version",
    id: normalizeAssetId(String(definitionValue.definitionId)),
    version: definitionValue.version,
  };
}

function instanceReference(id: string): AssetReference {
  return { kind: "asset-instance", id: normalizeAssetId(id) };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
