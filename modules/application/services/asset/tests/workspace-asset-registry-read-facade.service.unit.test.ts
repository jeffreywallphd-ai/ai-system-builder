import test from "node:test";
import assert from "node:assert/strict";

import type { AssetReference } from "../../../../contracts/asset";
import type {
  WorkspaceId,
  WorkspaceRecord,
  WorkspaceSystemPackActivation,
} from "../../../../contracts/workspace";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type { AssetRegistryDefinitionReadPort } from "../../../ports/asset";
import type {
  WorkspaceRepository,
  WorkspaceSystemPackActivationRepository,
} from "../../../ports/workspace";
import { ListWorkspaceSystemPackActivationsUseCase } from "../../../use-cases/workspace";
import {
  SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
  SYSTEM_FOUNDATION_PACK_ID,
  SYSTEM_FOUNDATION_PACK_VERSION,
} from "../../asset-packs/system-packs/system-foundation-pack.constants";
import { SYSTEM_FOUNDATION_PACK_MANIFEST } from "../../asset-packs/system-packs/system-foundation-pack.manifest";
import { SYSTEM_FOUNDATION_CURRENT_PACK_MANIFEST } from "../../asset-packs/system-packs/system-foundation-pack-v3.manifest";
import {
  WorkspaceAssetRegistryReadFacade,
  WorkspaceAssetRegistryReadFacadeError,
} from "../workspace-asset-registry-read-facade.service";
import type {
  AssetDefinitionCard,
  AssetDefinitionDetail,
  AssetRegistryListQuery,
  AssetRegistryResourceBackedViewCard,
  AssetRegistryResourceBackedViewDetail,
} from "../asset-registry-read-facade.types";

const workspaceA = createWorkspaceId("workspace-a");
const workspaceB = createWorkspaceId("workspace-b");
const archivedWorkspace = createWorkspaceId("workspace-archived");
const foundationRef: AssetReference =
  SYSTEM_FOUNDATION_PACK_MANIFEST.assets[0]!.definitionRef;

class FakeReadPort implements AssetRegistryDefinitionReadPort {
  public listCalls: AssetRegistryListQuery[] = [];
  public detailCalls: AssetReference[] = [];
  public cards: AssetDefinitionCard[] = [
    foundationCard(),
    bareSourcePackCard(),
    wrongTrustCard(),
    customCard(),
  ];
  public detailEnabled = true;
  public resourceCards: AssetRegistryResourceBackedViewCard[] = [
    artifactResourceCard(),
  ];
  public resourceDetail: AssetRegistryResourceBackedViewDetail | undefined = {
    view: { viewId: "global", viewKind: "artifact" },
  } as never;

  async listDefinitionCards(query: AssetRegistryListQuery = {}) {
    this.listCalls.push(query);
    return { items: this.cards };
  }

  async readDefinitionDetail(
    ref: AssetReference,
  ): Promise<AssetDefinitionDetail | undefined> {
    this.detailCalls.push(ref);
    if (!this.detailEnabled) return undefined;
    if (String(ref.id) !== foundationRef.id) return undefined;
    return {
      definition: {
        definitionId: foundationRef.id,
        version: "1.0.0",
        assetType: "ui-component",
        assetFamily: "primitive",
        displayName: "Foundation Button",
        description: "A system foundation button.",
        lifecycleStatus: "stable",
        provenance: { sourceKind: "system-generated" },
        metadata: {
          sourcePackId: SYSTEM_FOUNDATION_PACK_ID,
          sourcePackVersion: SYSTEM_FOUNDATION_PACK_VERSION,
          sourceKind: "system",
          sourceLayer: "system-default",
          trustStatus: "system-trusted",
          systemDefault: true,
        },
      },
    } as AssetDefinitionDetail;
  }

  async listResourceBackedViewCards() {
    return { items: this.resourceCards } as never;
  }

  async readResourceBackedViewDetail() {
    return this.resourceDetail as never;
  }
}

class FakeWorkspaceRepo implements WorkspaceRepository {
  public records = new Map<WorkspaceId, WorkspaceRecord>([
    [workspaceA, workspaceRecord(workspaceA, "Workspace A", "active")],
    [workspaceB, workspaceRecord(workspaceB, "Workspace B", "active")],
    [
      archivedWorkspace,
      workspaceRecord(archivedWorkspace, "Archived", "archived"),
    ],
  ]);
  async listWorkspaces() {
    return [...this.records.values()];
  }
  async readWorkspace(workspaceId: WorkspaceId) {
    return this.records.get(workspaceId);
  }
  async saveWorkspace(workspace: WorkspaceRecord) {
    this.records.set(workspace.workspaceId, workspace);
  }
  async updateWorkspace(workspace: WorkspaceRecord) {
    this.records.set(workspace.workspaceId, workspace);
  }
  async archiveWorkspace(workspaceId: WorkspaceId) {
    return this.records.get(workspaceId);
  }
}

class FakeActivationRepo implements WorkspaceSystemPackActivationRepository {
  public activations = new Map<WorkspaceId, WorkspaceSystemPackActivation[]>();
  async listWorkspaceSystemPackActivations(workspaceId: WorkspaceId) {
    return this.activations.get(workspaceId) ?? [];
  }
  async readWorkspaceSystemPackActivation(
    workspaceId: WorkspaceId,
    activationId: string,
  ) {
    return (this.activations.get(workspaceId) ?? []).find(
      (item) => item.activationId === activationId,
    );
  }
  async saveWorkspaceSystemPackActivation(
    activation: WorkspaceSystemPackActivation,
  ) {
    this.activations.set(activation.workspaceId, [
      ...(this.activations.get(activation.workspaceId) ?? []),
      activation,
    ]);
  }
  async updateWorkspaceSystemPackActivation(
    activation: WorkspaceSystemPackActivation,
  ) {
    await this.saveWorkspaceSystemPackActivation(activation);
  }
}

class FakeLinkRepo {
  public links: Record<string, any[]> = {};
  async listWorkspaceUserLibraryLinkRecords(query: {
    targetWorkspaceId: WorkspaceId;
  }) {
    return { links: this.links[query.targetWorkspaceId] ?? [] };
  }
}

class FakeUserLibraryAssetRepo {
  public assets = new Map<string, any>();
  async readUserLibraryAssetRecord(reference: {
    assetId: string;
    version?: string;
  }) {
    return this.assets.get(`${reference.assetId}@${reference.version ?? ""}`);
  }
}

class FakeDetachedCopyRepo {
  public records: Record<string, any[]> = {};
  async listWorkspaceUserLibraryDetachedCopyRecords(query: {
    targetWorkspaceId: WorkspaceId;
  }) {
    return { records: this.records[query.targetWorkspaceId] ?? [] };
  }
}

class FakeImportRepo {
  public records: Record<string, any[]> = {};
  async listWorkspaceToWorkspaceImportRecords(query: {
    targetWorkspaceId: WorkspaceId;
  }) {
    return { records: this.records[query.targetWorkspaceId] ?? [] };
  }
}

class FakeAuthoredAssetRepo {
  public byWorkspace: Record<string, any[]> = {};
  async findAuthoredAssetByBaseReference(
    workspaceId: WorkspaceId,
    baseAssetReference: AssetReference,
  ) {
    return (this.byWorkspace[workspaceId] ?? []).find(
      (r) => r.assetReference.id === baseAssetReference.id,
    );
  }
}

class FakeRevisionRepo {
  public revisions = new Map<string, any>();
  async readAssetRevisionRecord(
    workspaceId: WorkspaceId,
    authoredAssetId: string,
    revisionId: string,
  ) {
    return this.revisions.get(
      `${workspaceId}:${authoredAssetId}:${revisionId}`,
    );
  }
}

class FakeOverrideRepo {
  public active: Record<string, any[]> = {};
  public conflicted: Record<string, any[]> = {};
  async findActiveOverrideForTarget(
    workspaceId: WorkspaceId,
    targetAssetReference: AssetReference,
  ) {
    return (this.active[workspaceId] ?? []).find(
      (r) =>
        r.customizationTarget.effectiveAssetReference.id ===
        targetAssetReference.id,
    );
  }
  async listConflictedOverridesByWorkspace(workspaceId: WorkspaceId) {
    return this.conflicted[workspaceId] ?? [];
  }
}
test("Workspace A with active system.foundation@1.0.0 sees strict foundation cards", async () => {
  const { facade, activations } = setup();
  activations.activations.set(workspaceA, [activation(workspaceA, "active")]);
  const result = await facade.listDefinitionCards({ workspaceId: workspaceA });
  assert.equal(
    result.items.some((item) => item.definitionId === foundationRef.id),
    true,
  );
  assert.equal(
    result.items.length >= SYSTEM_FOUNDATION_PACK_MANIFEST.assets.length,
    true,
  );
  assert.equal(
    result.items.every(
      (item) => item.sourcePackId === SYSTEM_FOUNDATION_PACK_ID,
    ),
    true,
  );
});

test("current Foundation activation exposes only exact 3.0.0 cards and details", async () => {
  const { facade, activations, readPort } = setup();
  activations.activations.set(workspaceA, [
    {
      ...activation(workspaceA, "active"),
      packVersion: SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
    },
  ]);
  readPort.cards = [];
  readPort.detailEnabled = false;

  const result = await facade.listDefinitionCards({ workspaceId: workspaceA });
  assert.equal(
    result.items.length,
    SYSTEM_FOUNDATION_CURRENT_PACK_MANIFEST.assets.length,
  );
  assert.equal(
    result.items.every(
      (item) =>
        item.sourcePackVersion === SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
    ),
    true,
  );
  const currentRoot = SYSTEM_FOUNDATION_CURRENT_PACK_MANIFEST.assets.find(
    (entry) =>
      String(entry.definition.definitionId) === "builtin.system.system",
  );
  assert.ok(currentRoot);
  const detail = await facade.readDefinitionDetail(currentRoot.definitionRef, {
    workspaceId: workspaceA,
  });
  assert.equal(
    detail?.definition.version,
    SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
  );
  assert.equal(detail?.definition.slots?.[0]?.slotId, "application-shell");
});

test("active workspaces see System Foundation from the manifest even when definitions were not installed", async () => {
  const { facade, activations, readPort } = setup();
  activations.activations.set(workspaceA, [activation(workspaceA, "active")]);
  readPort.cards = [];
  readPort.detailEnabled = false;
  const list = await facade.listDefinitionCards({ workspaceId: workspaceA });
  assert.equal(
    list.items.length,
    SYSTEM_FOUNDATION_PACK_MANIFEST.assets.length,
  );
  const detail = await facade.readDefinitionDetail(foundationRef, {
    workspaceId: workspaceA,
  });
  assert.equal(detail?.definition.definitionId, foundationRef.id);
  assert.equal(
    (detail?.definition.metadata as Record<string, unknown> | undefined)
      ?.sourceKind,
    "system",
  );
});

test("Workspace B without activation does not see foundation cards", async () => {
  const { facade } = setup();
  const result = await facade.listDefinitionCards({ workspaceId: workspaceB });
  assert.equal(result.items.length, 0);
});

test("inactive, failed, and unknown activations exclude assets with safe diagnostics", async () => {
  for (const status of ["inactive", "failed"] as const) {
    const { facade, activations } = setup();
    activations.activations.set(workspaceA, [activation(workspaceA, status)]);
    const result = await facade.listDefinitionCards({
      workspaceId: workspaceA,
    });
    assert.equal(result.items.length, 0);
    assert.match(
      result.diagnostics?.map((entry) => entry.code).join(" ") ?? "",
      new RegExp(status),
    );
  }

  const { facade, activations } = setup();
  activations.activations.set(workspaceA, [
    { ...activation(workspaceA, "active"), packId: "system.unknown" as never },
  ]);
  const result = await facade.listDefinitionCards({ workspaceId: workspaceA });
  assert.equal(result.items.length, 0);
  assert.equal(
    result.diagnostics?.some(
      (entry) => entry.code === "workspace-system-pack-activation-unknown-pack",
    ),
    true,
  );
  assert.equal(JSON.stringify(result).includes("/"), false);
});

test("wrong source or trust metadata and bare sourcePackId do not prove system authority", async () => {
  const { facade, activations } = setup();
  activations.activations.set(workspaceA, [activation(workspaceA, "active")]);
  const result = await facade.listDefinitionCards({ workspaceId: workspaceA });
  assert.equal(
    result.items.some((item) => item.definitionId === "bare.foundation"),
    false,
  );
  assert.equal(
    result.items.some((item) => item.definitionId === "wrong.trust"),
    false,
  );
});

test("missing, invalid, unknown, and archived workspace fail safely without global fallback", async () => {
  const { facade, readPort } = setup();
  await assertWorkspaceError(
    () => facade.listDefinitionCards(),
    "workspace-required",
  );
  await assertWorkspaceError(
    () => facade.listDefinitionCards({ workspaceId: "../unsafe" }),
    "workspace-invalid",
  );
  await assertWorkspaceError(
    () => facade.listDefinitionCards({ workspaceId: "missing-workspace" }),
    "workspace-not-found",
  );
  await assertWorkspaceError(
    () => facade.listDefinitionCards({ workspaceId: archivedWorkspace }),
    "workspace-unavailable",
  );
  assert.equal(readPort.listCalls.length, 0);
});

test("detail reads enforce effective view membership and cannot bypass missing activation", async () => {
  const { facade, activations } = setup();
  await assert.rejects(
    () =>
      facade.readDefinitionDetail(foundationRef, { workspaceId: workspaceB }),
    (error) => {
      assert.equal(
        (error as WorkspaceAssetRegistryReadFacadeError).code,
        "workspace-asset-not-in-effective-view",
      );
      return true;
    },
  );
  activations.activations.set(workspaceA, [activation(workspaceA, "active")]);
  const detail = await facade.readDefinitionDetail(foundationRef, {
    workspaceId: workspaceA,
  });
  assert.equal(detail?.definition.displayName, "Foundation Button");
});

test("detail membership is deterministic for effective assets beyond arbitrary list pages", async () => {
  const { facade, activations, readPort } = setup();
  activations.activations.set(workspaceA, [activation(workspaceA, "active")]);
  readPort.cards = Array.from({ length: 300 }, (_, index) => ({
    ...customCard(),
    definitionId: `custom.global.${index}`,
    displayName: `Custom ${index}`,
  }));
  const detail = await facade.readDefinitionDetail(foundationRef, {
    workspaceId: workspaceA,
  });
  assert.equal(detail?.definition.displayName, "Foundation Button");
  assert.equal(
    readPort.listCalls.some((query) => query.limit === 250),
    false,
  );
});

test("resource-backed descriptors expose workspace-scoped model views without leaking other families", async () => {
  const { facade, activations, readPort } = setup();
  activations.activations.set(workspaceA, [activation(workspaceA, "active")]);
  readPort.resourceCards = [artifactResourceCard(), modelResourceCard()];
  readPort.resourceDetail = {
    view: { viewId: "asset-view.model.internal.model-1", viewKind: "model" },
  } as never;
  const list = await facade.listResourceBackedViewCards({
    workspaceId: workspaceA,
  });
  assert.deepEqual(
    list.items.map((item) => item.viewId),
    ["asset-view.model.internal.model-1"],
  );
  const detail = await facade.readResourceBackedViewDetail(
    "asset-view.model.internal.model-1",
    { workspaceId: workspaceA },
  );
  assert.equal(detail?.view.viewKind, "model");
  readPort.resourceDetail = {
    view: { viewId: "global", viewKind: "artifact" },
  } as never;
  assert.equal(
    await facade.readResourceBackedViewDetail("global", {
      workspaceId: workspaceA,
    }),
    undefined,
  );
  const artifactOnly = await facade.listResourceBackedViewCards({
    workspaceId: workspaceA,
    viewKinds: ["artifact"],
  });
  assert.equal(artifactOnly.items.length, 0);
  assert.equal(
    artifactOnly.diagnostics?.[0]?.code,
    "workspace-resource-backed-view-deferred",
  );
});

test("results are deterministic and diagnostics are sanitized", async () => {
  const { facade, activations } = setup();
  activations.activations.set(workspaceA, [activation(workspaceA, "active")]);
  const first = await facade.listDefinitionCards({ workspaceId: workspaceA });
  const second = await facade.listDefinitionCards({ workspaceId: workspaceA });
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first).includes("/tmp"), false);
});

test("effective source summaries include linked, copied, and imported kinds with workspace isolation", async () => {
  const {
    facade,
    activations,
    readPort,
    links,
    libraryAssets,
    detachedCopies,
    imports,
  } = setup();
  activations.activations.set(workspaceA, [activation(workspaceA, "active")]);
  readPort.cards = [
    foundationCard(),
    {
      ...customCard(),
      definitionRef: {
        kind: "asset-definition",
        id: "a.linked",
        version: "1.0.0",
      } as AssetReference,
      definitionId: "a.linked",
    },
    {
      ...customCard(),
      definitionRef: {
        kind: "asset-definition",
        id: "a.copy",
        version: "1.0.0",
      } as AssetReference,
      definitionId: "a.copy",
    },
    {
      ...customCard(),
      definitionRef: {
        kind: "asset-definition",
        id: "a.import",
        version: "1.0.0",
      } as AssetReference,
      definitionId: "a.import",
    },
  ];
  links.links[workspaceA] = [
    {
      linkId: "link.1",
      targetWorkspaceId: workspaceA,
      userLibraryAssetReference: { assetId: "library.a", version: "1.0.0" },
      versionSelection: { kind: "pinned-version", version: "1.0.0" },
      propagationPolicy: "pinned-version",
      status: "active",
      createdAt: "2026",
      updatedAt: "2026",
      provenance: {
        kind: "linked-from-user-library-asset",
        operationAt: "2026",
      },
    },
  ];
  libraryAssets.assets.set("library.a@1.0.0", {
    status: "active",
    assetReference: {
      kind: "asset-definition",
      id: "a.linked",
      version: "1.0.0",
    },
  });
  detachedCopies.records[workspaceA] = [
    {
      targetWorkspaceId: workspaceA,
      copiedAssetReference: {
        kind: "asset-definition",
        id: "a.copy",
        version: "1.0.0",
      },
      sourceUserLibraryAssetReference: {
        assetId: "library.copy",
        version: "1.0.0",
      },
      status: "active",
      provenance: {
        kind: "copied-from-user-library-asset",
        sourceUserLibraryAssetReference: {
          assetId: "library.copy",
          version: "1.0.0",
        },
        operationAt: "2026",
      },
    },
  ];
  imports.records[workspaceA] = [
    {
      sourceWorkspaceId: workspaceB,
      targetWorkspaceId: workspaceA,
      sourceAssetReference: {
        kind: "asset-definition",
        id: "b.src",
        version: "2.0.0",
      },
      importedAssetReference: {
        kind: "asset-definition",
        id: "a.import",
        version: "2.0.0",
      },
      status: "active",
      provenance: {
        kind: "imported-from-workspace-asset",
        operationAt: "2026",
      },
    },
  ];
  const result = await facade.listDefinitionCards({ workspaceId: workspaceA });
  const kinds = Object.fromEntries(
    result.items.map((item) => [
      item.definitionId,
      item.effectiveSourceSummary?.effectiveSourceKind,
    ]),
  );
  assert.equal(kinds[foundationRef.id], "system-activated");
  assert.equal(kinds["a.linked"], "user-library-linked");
  assert.equal(kinds["a.copy"], "user-library-copied");
  assert.equal(kinds["a.import"], "workspace-imported");
  const bResult = await facade.listDefinitionCards({ workspaceId: workspaceB });
  assert.equal(
    bResult.items.some((item) => item.definitionId === "a.linked"),
    false,
  );
});

test("phase8 authoring summaries classify authored and override sources", async () => {
  const {
    facade,
    activations,
    readPort,
    authoredAssets,
    revisions,
    overrides,
  } = setup();
  activations.activations.set(workspaceA, [activation(workspaceA, "active")]);
  readPort.cards = [
    {
      ...customCard(),
      definitionRef: {
        kind: "asset-definition",
        id: "a.authored",
        version: "1.0.0",
      } as AssetReference,
      definitionId: "a.authored",
    },
    {
      ...customCard(),
      definitionRef: {
        kind: "asset-definition",
        id: "a.link-override",
        version: "1.0.0",
      } as AssetReference,
      definitionId: "a.link-override",
    },
  ];
  authoredAssets.byWorkspace[workspaceA] = [
    {
      authoredAssetId: "auth.1",
      workspaceId: workspaceA,
      assetReference: {
        kind: "asset-definition",
        id: "a.authored",
        version: "1.0.0",
      },
      currentRevisionId: "rev.1",
      provenance: { kind: "authored-from-scratch" },
    },
  ];
  revisions.revisions.set(`${workspaceA}:auth.1:rev.1`, { revision: "r1" });
  overrides.active[workspaceA] = [
    {
      overrideId: "ov.1",
      status: "active",
      conflictStatus: undefined,
      baseAssetReference: {
        kind: "asset-definition",
        id: "base",
        version: "1.0.0",
      },
      customizationTarget: {
        sourceKind: "user-library-linked-asset",
        effectiveAssetReference: {
          kind: "asset-definition",
          id: "a.link-override",
          version: "1.0.0",
        },
      },
      provenance: { kind: "customized-linked-user-library-asset" },
    },
  ];
  const result = await facade.listDefinitionCards({ workspaceId: workspaceA });
  const authored = result.items.find((i) => i.definitionId === "a.authored");
  const linkedOverride = result.items.find(
    (i) => i.definitionId === "a.link-override",
  );
  assert.equal(
    authored?.assetAuthoringEffectiveSourceSummary?.effectiveSourceKind,
    "workspace-authored",
  );
  assert.equal(
    linkedOverride?.assetAuthoringEffectiveSourceSummary?.effectiveSourceKind,
    "linked-with-workspace-override",
  );
});
async function assertWorkspaceError(
  action: () => Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(action, (error) => {
    assert.equal((error as WorkspaceAssetRegistryReadFacadeError).code, code);
    return true;
  });
}

function setup() {
  const readPort = new FakeReadPort();
  const activations = new FakeActivationRepo();
  const links = new FakeLinkRepo();
  const libraryAssets = new FakeUserLibraryAssetRepo();
  const detachedCopies = new FakeDetachedCopyRepo();
  const imports = new FakeImportRepo();
  const authoredAssets = new FakeAuthoredAssetRepo();
  const revisions = new FakeRevisionRepo();
  const overrides = new FakeOverrideRepo();
  const facade = new WorkspaceAssetRegistryReadFacade({
    assetRegistryRead: readPort,
    listWorkspaceSystemPackActivations:
      new ListWorkspaceSystemPackActivationsUseCase({
        systemPackActivationRepository: activations,
      }),
    workspaceRepository: new FakeWorkspaceRepo(),
    workspaceUserLibraryLinkRepository: links as any,
    userLibraryAssetRepository: libraryAssets as any,
    detachedCopyRepository: detachedCopies as any,
    workspaceImportRepository: imports as any,
    authoredAssetRepository: authoredAssets as any,
    assetRevisionRepository: revisions as any,
    assetOverrideRepository: overrides as any,
  });
  return {
    facade,
    activations,
    readPort,
    links,
    libraryAssets,
    detachedCopies,
    imports,
    authoredAssets,
    revisions,
    overrides,
  };
}

function foundationCard(): AssetDefinitionCard {
  return {
    definitionRef: foundationRef,
    definitionId: foundationRef.id,
    version: "1.0.0",
    assetType: "ui-component",
    assetFamily: "primitive",
    displayName: "Foundation Button",
    lifecycleStatus: "stable",
    builtIn: true,
    sourcePackId: SYSTEM_FOUNDATION_PACK_ID,
    sourcePackVersion: SYSTEM_FOUNDATION_PACK_VERSION,
    sourceKind: "system",
    sourceLayer: "system-default",
    trustStatus: "system-trusted",
    systemDefault: true,
  } as AssetDefinitionCard;
}

function bareSourcePackCard(): AssetDefinitionCard {
  return {
    ...foundationCard(),
    definitionId: "bare.foundation",
    displayName: "Bare",
    sourceKind: undefined,
    sourceLayer: undefined,
    trustStatus: undefined,
    systemDefault: undefined,
  };
}

function wrongTrustCard(): AssetDefinitionCard {
  return {
    ...foundationCard(),
    definitionId: "wrong.trust",
    displayName: "Wrong",
    trustStatus: "unverified",
  };
}

function customCard(): AssetDefinitionCard {
  return {
    ...foundationCard(),
    definitionId: "custom.global",
    displayName: "Custom",
    sourcePackId: undefined,
    sourcePackVersion: undefined,
    sourceKind: undefined,
    sourceLayer: undefined,
    trustStatus: undefined,
    systemDefault: undefined,
    builtIn: false,
  };
}

function artifactResourceCard(): AssetRegistryResourceBackedViewCard {
  return {
    viewId: "global",
    viewKind: "artifact",
    displayName: "Global leak",
    assetType: "artifact",
    assetFamily: "resource-backed",
  } as AssetRegistryResourceBackedViewCard;
}

function modelResourceCard(): AssetRegistryResourceBackedViewCard {
  return {
    viewId: "asset-view.model.internal.model-1",
    viewKind: "model",
    displayName: "Shared Model",
    assetType: "model",
    assetFamily: "resource-backed",
  } as AssetRegistryResourceBackedViewCard;
}

function activation(
  workspaceId: WorkspaceId,
  status: "active" | "inactive" | "failed",
): WorkspaceSystemPackActivation {
  return {
    activationId: `activation.${workspaceId}.${status}`,
    workspaceId,
    packId: SYSTEM_FOUNDATION_PACK_ID,
    packVersion: SYSTEM_FOUNDATION_PACK_VERSION,
    sourceKind: "system",
    sourceLayer: "system-default",
    trustStatus: "system-trusted",
    status,
    activatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function workspaceRecord(
  workspaceId: WorkspaceId,
  displayName: string,
  status: WorkspaceRecord["status"],
): WorkspaceRecord {
  return {
    workspaceId,
    displayName,
    status,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
