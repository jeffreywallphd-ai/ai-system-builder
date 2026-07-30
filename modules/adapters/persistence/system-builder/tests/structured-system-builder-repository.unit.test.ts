import { describe, expect, it } from "../../../../testing/node-test";
import type {
  SystemBuilderRecord,
  SystemBuilderRevision,
} from "../../../../contracts/system-builder";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createInMemoryStructuredDocumentStore } from "../../shared";
import { createStructuredSystemBuilderRepository } from "../createStructuredSystemBuilderRepository";

const createdAt = "2026-07-18T12:00:00.000Z";
const workspaceA = createWorkspaceId("workspace-a");
const workspaceB = createWorkspaceId("workspace-b");

describe("structured System Builder repository", () => {
  it("round-trips slot revisions immutably and isolates workspaces", async () => {
    const repository = createStructuredSystemBuilderRepository(
      createInMemoryStructuredDocumentStore(),
    );
    const revision = slotRevision();
    const record = systemRecord(revision);

    const created = await repository.createRecordAndRevision(record, revision);
    expect(created.revision.structure).toEqual(revision.structure);
    expect(created.revision.placements).toEqual(revision.placements);

    (created.revision as any).placements[0].slotId = "mutated";
    const reread = await repository.readRevision(
      workspaceA,
      revision.systemId,
      revision.revisionId,
    );
    expect(reread?.placements?.[0]?.slotId).toBe("application-shell");
    expect(
      await repository.readRevision(
        workspaceB,
        revision.systemId,
        revision.revisionId,
      ),
    ).toBeUndefined();

    await expect(
      repository.createRecordAndRevision(record, revision),
    ).rejects.toThrow(/conflict/i);
  });

  it("atomically advances records with complete slot-based revisions", async () => {
    const repository = createStructuredSystemBuilderRepository(
      createInMemoryStructuredDocumentStore(),
    );
    const first = slotRevision();
    const firstRecord = systemRecord(first);
    await repository.createRecordAndRevision(firstRecord, first);

    const second = {
      ...first,
      revisionId: "system-revision-2",
      revisionNumber: 2,
      createdAt: "2026-07-18T12:05:00.000Z",
    } as SystemBuilderRevision;
    const secondRecord = {
      ...firstRecord,
      revision: 2,
      currentRevisionId: second.revisionId,
      updatedAt: second.createdAt,
    } as SystemBuilderRecord;
    const saved = await repository.saveRevisionAndRecord(
      second,
      secondRecord,
      1,
    );

    expect(saved.revision.structure).toEqual(first.structure);
    expect(saved.revision.placements).toEqual(first.placements);
    expect(
      (await repository.readRecord(workspaceA, first.systemId))?.revision,
    ).toBe(2);
    await expect(
      repository.saveRevisionAndRecord(
        { ...second, revisionId: "system-revision-3" } as SystemBuilderRevision,
        { ...secondRecord, revision: 2 } as SystemBuilderRecord,
        1,
      ),
    ).rejects.toThrow(/conflict/i);
  });
});

function slotRevision(): SystemBuilderRevision {
  const rootRef = { kind: "asset-instance", id: "instance.root" } as const;
  const shellRef = { kind: "asset-instance", id: "instance.shell" } as const;
  return {
    revisionId: "system-revision-1",
    systemId: "system-1",
    targetWorkspaceId: workspaceA,
    revisionNumber: 1,
    composition: {
      compositionId: "system-1.composition",
      compositionType: "system",
      displayName: "Portal",
      version: "0.1.0",
      lifecycleStatus: "draft",
      rootInstanceRefs: [rootRef],
      instanceRefs: [rootRef, shellRef],
      bindingRefs: [],
      provenance: { sourceKind: "human-authored" },
    },
    instances: [
      {
        instanceId: rootRef.id,
        definitionRef: {
          kind: "asset-definition-version",
          id: "builtin.system.system",
          version: "2.0.0",
        },
        lifecycleStatus: "draft",
        selectedConfiguration: {},
        provenance: { sourceKind: "human-authored" },
      },
      {
        instanceId: shellRef.id,
        definitionRef: {
          kind: "asset-definition-version",
          id: "builtin.layout.application.standard",
          version: "2.0.0",
        },
        lifecycleStatus: "draft",
        selectedConfiguration: {},
        provenance: { sourceKind: "human-authored" },
      },
    ],
    bindings: [],
    structure: {
      schemaVersion: "system-builder-structure.v1",
      profile: "interactive",
      layoutPresetRef: {
        kind: "asset-definition-version",
        id: "builtin.layout.application.standard",
        version: "2.0.0",
      },
    },
    placements: [
      {
        schemaVersion: "asset-placement.v1",
        placementId: "placement.root-shell",
        parentInstanceRef: rootRef,
        slotId: "application-shell",
        childInstanceRef: shellRef,
        order: 0,
      },
    ],
    validationIssues: [],
    createdAt,
    createdBy: "person-1",
  } as SystemBuilderRevision;
}

function systemRecord(revision: SystemBuilderRevision): SystemBuilderRecord {
  return {
    systemId: revision.systemId,
    targetWorkspaceId: workspaceA,
    name: "Portal",
    status: "draft",
    revision: 1,
    currentRevisionId: revision.revisionId,
    composition: revision.composition,
    createdAt,
    updatedAt: createdAt,
    createdBy: "person-1",
    updatedBy: "person-1",
  } as SystemBuilderRecord;
}
