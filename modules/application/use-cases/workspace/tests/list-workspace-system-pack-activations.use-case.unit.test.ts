import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  normalizeAssetPackId,
  type AssetPackId,
} from "../../../../contracts/asset";
import {
  createWorkspaceId,
  type WorkspaceId,
  type WorkspaceSystemPackActivation,
} from "../../../../contracts/workspace";
import type { WorkspaceSystemPackActivationRepository } from "../../../ports/workspace";
import {
  SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
  SYSTEM_FOUNDATION_PACK_ID,
  SYSTEM_FOUNDATION_PACK_VERSION,
} from "../../../services/asset-packs/system-packs/system-foundation-pack.constants";
import {
  createSystemFoundationWorkspaceActivation,
  getKnownSystemPackReference,
  isKnownSystemPackActivation,
  ListWorkspaceSystemPackActivationsUseCase,
} from "..";

const workspaceId = createWorkspaceId("workspace.activation-list");
const otherWorkspaceId = createWorkspaceId("workspace.other");
const timestamp = "2026-05-14T00:00:00.000Z";

class FakeActivationRepository implements WorkspaceSystemPackActivationRepository {
  public activations: WorkspaceSystemPackActivation[] = [];
  public failList = false;
  public updateCalls = 0;

  public async listWorkspaceSystemPackActivations(
    id: WorkspaceId,
  ): Promise<readonly WorkspaceSystemPackActivation[]> {
    if (this.failList)
      throw new Error(
        "/private/path SECRET_TOKEN stack trace curl http://localhost env base64",
      );
    return this.activations.filter(
      (activation) => activation.workspaceId === id,
    );
  }

  public async readWorkspaceSystemPackActivation(
    id: WorkspaceId,
    activationId: string,
  ): Promise<WorkspaceSystemPackActivation | undefined> {
    return this.activations.find(
      (activation) =>
        activation.workspaceId === id &&
        activation.activationId === activationId,
    );
  }

  public async saveWorkspaceSystemPackActivation(
    activation: WorkspaceSystemPackActivation,
  ): Promise<void> {
    this.activations.push(activation);
  }

  public async updateWorkspaceSystemPackActivation(
    activation: WorkspaceSystemPackActivation,
  ): Promise<void> {
    this.updateCalls += 1;
    const index = this.activations.findIndex(
      (candidate) =>
        candidate.workspaceId === activation.workspaceId &&
        candidate.activationId === activation.activationId,
    );
    if (index >= 0) this.activations[index] = activation;
  }
}

function makeActivation(
  overrides: Partial<WorkspaceSystemPackActivation> = {},
): WorkspaceSystemPackActivation {
  return {
    ...createSystemFoundationWorkspaceActivation(workspaceId, timestamp),
    ...overrides,
  };
}

function makeUseCase(repository = new FakeActivationRepository()): {
  repository: FakeActivationRepository;
  useCase: ListWorkspaceSystemPackActivationsUseCase;
} {
  return {
    repository,
    useCase: new ListWorkspaceSystemPackActivationsUseCase({
      systemPackActivationRepository: repository,
    }),
  };
}

function stringify(value: unknown): string {
  return JSON.stringify(value);
}

function assertSafe(value: unknown): void {
  assert.doesNotMatch(
    stringify(value),
    /SECRET|TOKEN|private|\/tmp|\/Users|C:\\|stack|curl|env|base64|localhost/i,
  );
}

function assertReferenceOnly(value: unknown): void {
  const text = stringify(value);
  assert.doesNotMatch(
    text,
    /assetDefinitions|definitions|entries|manifest|contents|bytes|base64|resourceBytes/i,
  );
}

describe("ListWorkspaceSystemPackActivationsUseCase", () => {
  it("returns active system.foundation@1.0.0 as a compact active system pack", async () => {
    const { repository, useCase } = makeUseCase();
    repository.activations.push(makeActivation());

    const result = await useCase.execute(workspaceId);

    assert.equal(result.status, "listed");
    assert.deepEqual(result.activeSystemPacks, [
      {
        workspaceId,
        packId: SYSTEM_FOUNDATION_PACK_ID,
        packVersion: SYSTEM_FOUNDATION_PACK_VERSION,
        displayName: "System Foundation",
        sourceKind: "system",
        sourceLayer: "system-default",
        trustStatus: "system-trusted",
        activationId: `activation.system-foundation.${workspaceId}`,
        activatedAt: timestamp,
      },
    ]);
    assert.deepEqual(result.inactiveSystemPacks, []);
    assert.deepEqual(result.failedSystemPacks, []);
    assert.deepEqual(result.unknownSystemPackActivations, []);
    assertReferenceOnly(result);
  });

  it("returns empty active system packs when no activations exist", async () => {
    const result = await makeUseCase().useCase.execute(workspaceId);

    assert.equal(result.status, "listed");
    assert.deepEqual(result.activeSystemPacks, []);
    assert.deepEqual(result.diagnostics, []);
  });

  it("does not treat inactive or failed system.foundation activations as active", async () => {
    const { repository, useCase } = makeUseCase();
    repository.activations.push(
      makeActivation({
        activationId: "activation.inactive",
        status: "inactive",
      }),
      makeActivation({
        activationId: "activation.failed",
        status: "failed",
        activatedAt: "2026-05-14T01:00:00.000Z",
      }),
    );

    const result = await useCase.execute(workspaceId);

    assert.deepEqual(result.activeSystemPacks, []);
    assert.deepEqual(
      result.inactiveSystemPacks.map((activation) => activation.activationId),
      ["activation.inactive"],
    );
    assert.deepEqual(
      result.failedSystemPacks.map((activation) => activation.activationId),
      ["activation.failed"],
    );
    assert.equal(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "workspace-system-pack-activation-inactive",
      ),
      true,
    );
    assert.equal(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "workspace-system-pack-activation-failed",
      ),
      true,
    );
  });

  it("reports unknown pack IDs and versions without activating them", async () => {
    const { repository, useCase } = makeUseCase();
    repository.activations.push(
      makeActivation({
        activationId: "activation.unknown-id",
        packId: normalizeAssetPackId("system.unknown"),
      }),
      makeActivation({
        activationId: "activation.unknown-version",
        packVersion: "9.9.9",
      }),
    );

    const result = await useCase.execute(workspaceId);

    assert.deepEqual(result.activeSystemPacks, []);
    assert.deepEqual(
      result.unknownSystemPackActivations.map(
        (activation) => activation.activationId,
      ),
      ["activation.unknown-version", "activation.unknown-id"],
    );
    assert.equal(
      result.diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === "workspace-system-pack-activation-unknown-pack",
      ).length,
      2,
    );
  });

  it("reports wrong source, layer, or trust metadata without activating records", async () => {
    const { repository, useCase } = makeUseCase();
    repository.activations.push(
      makeActivation({
        activationId: "activation.wrong-source",
        sourceKind: "workspace" as "system",
      }),
      makeActivation({
        activationId: "activation.wrong-layer",
        sourceLayer: "installed-pack" as "system-default",
      }),
      makeActivation({
        activationId: "activation.wrong-trust",
        trustStatus: "trusted" as "system-trusted",
      }),
    );

    const result = await useCase.execute(workspaceId);

    assert.deepEqual(result.activeSystemPacks, []);
    assert.deepEqual(
      result.unknownSystemPackActivations.map(
        (activation) => activation.activationId,
      ),
      [
        "activation.wrong-layer",
        "activation.wrong-source",
        "activation.wrong-trust",
      ],
    );
    assert.equal(
      result.diagnostics.filter(
        (diagnostic) =>
          diagnostic.code ===
          "workspace-system-pack-activation-invalid-provenance",
      ).length,
      3,
    );
  });

  it("applies deterministic ordering and handles duplicate activation IDs and duplicate active pack references", async () => {
    const { repository, useCase } = makeUseCase();
    repository.activations.push(
      makeActivation({
        activationId: "activation.z",
        activatedAt: "2026-05-14T03:00:00.000Z",
      }),
      makeActivation({
        activationId: "activation.a",
        activatedAt: "2026-05-14T01:00:00.000Z",
      }),
      makeActivation({
        activationId: "activation.a",
        activatedAt: "2026-05-14T02:00:00.000Z",
      }),
    );

    const result = await useCase.execute(workspaceId);

    assert.deepEqual(
      result.activeSystemPacks.map((pack) => pack.activationId),
      ["activation.a"],
    );
    assert.equal(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "workspace-system-pack-activation-duplicate-id",
      ),
      true,
    );
    assert.equal(
      result.diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === "workspace-system-pack-activation-duplicate-pack",
      ).length,
      2,
    );
    assertSafe(result);
  });

  it("ignores records from other workspaces if a repository returns them", async () => {
    const repository = new FakeActivationRepository();
    repository.activations.push(
      makeActivation({ workspaceId: otherWorkspaceId }),
      makeActivation(),
    );
    const result = await new ListWorkspaceSystemPackActivationsUseCase({
      systemPackActivationRepository: {
        ...repository,
        listWorkspaceSystemPackActivations: async () => repository.activations,
      },
    }).execute(workspaceId);

    assert.deepEqual(
      result.activeSystemPacks.map((pack) => pack.workspaceId),
      [workspaceId],
    );
  });

  it("returns safe diagnostics for invalid workspace ids and repository failures", async () => {
    const invalid = await makeUseCase().useCase.execute(
      "../SECRET_TOKEN" as WorkspaceId,
    );
    assert.equal(invalid.status, "failed");
    assert.equal(
      invalid.diagnostics[0]?.code,
      "workspace-system-pack-activation-workspace-id-invalid",
    );
    assertSafe(invalid);

    const { repository, useCase } = makeUseCase();
    repository.failList = true;
    const failed = await useCase.execute(workspaceId);
    assert.equal(failed.status, "failed");
    assert.equal(
      failed.diagnostics[0]?.code,
      "workspace-system-pack-activation-list-failed",
    );
    assertSafe(failed);
  });

  it("recognizes only known system pack references and creates reference-only foundation activations", () => {
    const known = createSystemFoundationWorkspaceActivation(
      workspaceId,
      timestamp,
      { actorKind: "local-user", actorId: "actor-1" },
    );

    assert.equal(isKnownSystemPackActivation(known), true);
    assert.deepEqual(
      getKnownSystemPackReference(
        SYSTEM_FOUNDATION_PACK_ID,
        SYSTEM_FOUNDATION_PACK_VERSION,
      ),
      {
        packId: SYSTEM_FOUNDATION_PACK_ID,
        packVersion: SYSTEM_FOUNDATION_PACK_VERSION,
        displayName: "System Foundation",
        sourceKind: "system",
        sourceLayer: "system-default",
        trustStatus: "system-trusted",
      },
    );
    assert.equal(
      getKnownSystemPackReference(
        SYSTEM_FOUNDATION_PACK_ID,
        SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
      )?.packVersion,
      SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
    );
    assert.equal(
      getKnownSystemPackReference(
        normalizeAssetPackId("system.unknown") as AssetPackId,
        SYSTEM_FOUNDATION_PACK_VERSION,
      ),
      undefined,
    );
    assert.equal(
      getKnownSystemPackReference(SYSTEM_FOUNDATION_PACK_ID, "9.9.9"),
      undefined,
    );
    assert.equal(
      known.activationId,
      `activation.system-foundation.${workspaceId}`,
    );
    assert.equal(known.sourceKind, "system");
    assert.equal(known.sourceLayer, "system-default");
    assert.equal(known.trustStatus, "system-trusted");
    assertReferenceOnly(known);
    assert.equal("displayName" in known, false);
  });

  it("keeps activation use cases free of forbidden application boundaries and installers", () => {
    const source = [
      "modules/application/use-cases/workspace/list-workspace-system-pack-activations.use-case.ts",
      "modules/application/use-cases/workspace/read-workspace-system-pack-activation.use-case.ts",
      "modules/application/use-cases/workspace/set-workspace-system-pack-activation-status.use-case.ts",
      "modules/application/use-cases/workspace/workspace-system-pack-activation-policy.ts",
      "modules/application/use-cases/workspace/workspace-system-pack-activation-diagnostics.ts",
    ]
      .map((relativePath) =>
        readFileSync(join(process.cwd(), relativePath), "utf8"),
      )
      .join("\n");

    assert.doesNotMatch(
      source,
      /from\s+["'][^"']*(?:adapters|hosts|apps|ui|api|ipc|preload|renderer|thin-client|provider|runtime|node:fs|node:path)[^"']*["']/i,
    );
    assert.doesNotMatch(
      source,
      /InstallSystemAssetPackService|installSystemFoundationPack|install-system-asset-pack|install-system-foundation-pack/,
    );
    assert.doesNotMatch(
      source,
      /mkdir|writeFile|artifact|image|dataset|model|AssetLibrary|effective view/i,
    );
  });
});
