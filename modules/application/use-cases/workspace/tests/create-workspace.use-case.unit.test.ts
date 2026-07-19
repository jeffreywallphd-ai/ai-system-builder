import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  createWorkspaceId,
  isWorkspaceId,
  type ActiveWorkspaceSelection,
  type WorkspaceId,
  type WorkspaceRecord,
  type WorkspaceSystemPackActivation,
} from "../../../../contracts/workspace";
import type {
  WorkspaceRepository,
  WorkspaceSelectionRepository,
  WorkspaceSystemPackActivationRepository,
} from "../../../ports/workspace";
import {
  SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
  SYSTEM_FOUNDATION_PACK_ID,
} from "../../../services/asset-packs/system-packs/system-foundation-pack.constants";
import {
  CreateWorkspaceUseCase,
  WORKSPACE_DISPLAY_NAME_MAX_LENGTH,
  defaultGenerateWorkspaceId,
} from "..";

const timestamp = "2026-05-14T12:00:00.000Z";
const now = () => new Date(timestamp);
const workspaceId = createWorkspaceId("workspace.generated-01");
const otherWorkspaceId = createWorkspaceId("workspace.generated-02");

class FakeWorkspaceRepository implements WorkspaceRepository {
  public readonly records = new Map<WorkspaceId, WorkspaceRecord>();
  public saveCalls = 0;
  public failRead = false;
  public failSave = false;

  public async listWorkspaces(): Promise<readonly WorkspaceRecord[]> {
    return [...this.records.values()];
  }

  public async readWorkspace(
    id: WorkspaceId,
  ): Promise<WorkspaceRecord | undefined> {
    if (this.failRead)
      throw new Error("/private/path SECRET_TOKEN stack trace");
    return this.records.get(id);
  }

  public async saveWorkspace(workspace: WorkspaceRecord): Promise<void> {
    this.saveCalls += 1;
    if (this.failSave)
      throw new Error("/private/path SECRET_TOKEN stack trace");
    this.records.set(workspace.workspaceId, workspace);
  }

  public async updateWorkspace(workspace: WorkspaceRecord): Promise<void> {
    this.records.set(workspace.workspaceId, workspace);
  }

  public async archiveWorkspace(
    id: WorkspaceId,
    archivedAt: string,
  ): Promise<WorkspaceRecord | undefined> {
    const existing = this.records.get(id);
    if (!existing) return undefined;
    const archived = {
      ...existing,
      status: "archived" as const,
      updatedAt: archivedAt,
    };
    this.records.set(id, archived);
    return archived;
  }
}

class FakeActivationRepository implements WorkspaceSystemPackActivationRepository {
  public readonly activations: WorkspaceSystemPackActivation[] = [];
  public failSave = false;

  public async listWorkspaceSystemPackActivations(): Promise<
    readonly WorkspaceSystemPackActivation[]
  > {
    return this.activations;
  }

  public async readWorkspaceSystemPackActivation(
    _workspaceId: WorkspaceId,
    activationId: string,
  ): Promise<WorkspaceSystemPackActivation | undefined> {
    return this.activations.find(
      (activation) => activation.activationId === activationId,
    );
  }

  public async saveWorkspaceSystemPackActivation(
    activation: WorkspaceSystemPackActivation,
  ): Promise<void> {
    if (this.failSave)
      throw new Error("/private/path SECRET_TOKEN stack trace");
    this.activations.push(activation);
  }

  public async updateWorkspaceSystemPackActivation(
    activation: WorkspaceSystemPackActivation,
  ): Promise<void> {
    const index = this.activations.findIndex(
      (candidate) => candidate.activationId === activation.activationId,
    );
    if (index >= 0) this.activations[index] = activation;
  }
}

class FakeSelectionRepository implements WorkspaceSelectionRepository {
  public selection: ActiveWorkspaceSelection = {};
  public saveCalls = 0;
  public failSave = false;

  public async readActiveWorkspaceSelection(): Promise<ActiveWorkspaceSelection> {
    return this.selection;
  }

  public async saveActiveWorkspaceSelection(
    selection: ActiveWorkspaceSelection,
  ): Promise<void> {
    this.saveCalls += 1;
    if (this.failSave)
      throw new Error("/private/path SECRET_TOKEN stack trace");
    this.selection = selection;
  }

  public async clearActiveWorkspaceSelection(): Promise<void> {
    this.selection = {};
  }
}

function makeUseCase(
  overrides: Partial<{
    workspaceRepository: FakeWorkspaceRepository;
    activationRepository: FakeActivationRepository;
    selectionRepository: FakeSelectionRepository;
  }> = {},
) {
  const workspaceRepository =
    overrides.workspaceRepository ?? new FakeWorkspaceRepository();
  const activationRepository =
    overrides.activationRepository ?? new FakeActivationRepository();
  const selectionRepository =
    overrides.selectionRepository ?? new FakeSelectionRepository();
  const useCase = new CreateWorkspaceUseCase({
    workspaceRepository,
    systemPackActivationRepository: activationRepository,
    workspaceSelectionRepository: selectionRepository,
  });
  return {
    useCase,
    workspaceRepository,
    activationRepository,
    selectionRepository,
  };
}

function stringify(value: unknown): string {
  return JSON.stringify(value);
}

function assertSafeDiagnostics(value: unknown): void {
  const text = stringify(value);
  assert.doesNotMatch(
    text,
    /SECRET|TOKEN|private|\/tmp|\/Users|C:\\|stack|curl|env|base64/i,
  );
}

describe("CreateWorkspaceUseCase", () => {
  it("creates a workspace with a valid display name and generated id", async () => {
    const { useCase, workspaceRepository } = makeUseCase();
    const result = await useCase.execute({
      command: { displayName: "My Image Tools" },
      now,
      generateWorkspaceId: () => workspaceId,
    });

    assert.equal(result.status, "created");
    assert.equal(result.workspace?.displayName, "My Image Tools");
    assert.equal(result.workspace?.workspaceId, workspaceId);
    assert.equal(
      workspaceRepository.records.get(workspaceId)?.displayName,
      "My Image Tools",
    );
  });

  it("generates default workspace ids through the workspace id contract", async () => {
    const generatedId = defaultGenerateWorkspaceId();
    assert.equal(isWorkspaceId(generatedId), true);
    assert.doesNotMatch(generatedId, /[\\/]|^[a-zA-Z]:|:\/\/|\s|\.\./);

    const { useCase, workspaceRepository } = makeUseCase();
    const result = await useCase.execute({
      command: { displayName: "Default Generated Workspace" },
      now,
    });

    assert.equal(result.status, "created");
    assert.equal(isWorkspaceId(result.workspace?.workspaceId), true);
    assert.notEqual(
      result.workspace?.workspaceId,
      result.workspace?.displayName,
    );
    assert.equal(
      workspaceRepository.records.has(
        result.workspace?.workspaceId as WorkspaceId,
      ),
      true,
    );
  });

  it("trims display names and descriptions", async () => {
    const { useCase } = makeUseCase();
    const result = await useCase.execute({
      command: {
        displayName: "  Trimmed Workspace  ",
        description: "  A description  ",
      },
      now,
      generateWorkspaceId: () => workspaceId,
    });

    assert.equal(result.status, "created");
    assert.equal(result.workspace?.displayName, "Trimmed Workspace");
    assert.equal(result.workspace?.description, "A description");
    assert.equal(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "workspace-display-name-normalized",
      ),
      true,
    );
  });

  it("rejects empty and whitespace-only display names", async () => {
    for (const displayName of ["", "   "]) {
      const { useCase, workspaceRepository } = makeUseCase();
      const result = await useCase.execute({
        command: { displayName },
        now,
        generateWorkspaceId: () => workspaceId,
      });
      assert.equal(result.status, "failed");
      assert.equal(result.issues[0]?.code, "workspace-display-name-required");
      assert.equal(workspaceRepository.saveCalls, 0);
    }
  });

  it("rejects overlong, control-character, and path-like display names with safe diagnostics", async () => {
    const overlong = "a".repeat(WORKSPACE_DISPLAY_NAME_MAX_LENGTH + 1);
    for (const displayName of [overlong, "Bad\nName", "../secrets"]) {
      const { useCase } = makeUseCase();
      const result = await useCase.execute({
        command: { displayName },
        now,
        generateWorkspaceId: () => workspaceId,
      });
      assert.equal(result.status, "failed");
      assert.match(result.issues[0]?.code ?? "", /workspace-display-name/);
      assertSafeDiagnostics(result);
    }
  });

  it("requires generated workspace ids to be safe and not display-name-derived", async () => {
    const unsafe = await makeUseCase().useCase.execute({
      command: { displayName: "My Image Tools" },
      now,
      generateWorkspaceId: () => "My Image Tools" as WorkspaceId,
    });
    assert.equal(unsafe.status, "failed");
    assert.equal(unsafe.issues[0]?.code, "workspace-id-invalid");
    assertSafeDiagnostics(unsafe);

    const unsafePath = await makeUseCase().useCase.execute({
      command: { displayName: "My Image Tools" },
      now,
      generateWorkspaceId: () => "../private/SECRET_TOKEN" as WorkspaceId,
    });
    assert.equal(unsafePath.status, "failed");
    assert.equal(unsafePath.issues[0]?.code, "workspace-id-invalid");
    assertSafeDiagnostics(unsafePath);

    const safe = await makeUseCase().useCase.execute({
      command: { displayName: "workspace.generated-01" },
      now,
      generateWorkspaceId: () => otherWorkspaceId,
    });
    assert.equal(safe.status, "created");
    assert.equal(safe.workspace?.workspaceId, otherWorkspaceId);
    assert.notEqual(safe.workspace?.workspaceId, safe.workspace?.displayName);
  });

  it("handles workspace id generation failures safely", async () => {
    const result = await makeUseCase().useCase.execute({
      command: { displayName: "Workspace" },
      now,
      generateWorkspaceId: () => {
        throw new Error("/private/path SECRET_TOKEN stack trace");
      },
    });
    assert.equal(result.status, "failed");
    assert.equal(result.issues[0]?.code, "workspace-id-generation-failed");
    assertSafeDiagnostics(result);
  });

  it("creates a passive workspace record without embedded resources or definitions", async () => {
    const actor = {
      actorKind: "local-user" as const,
      actorId: "local-user-1",
      displayName: "Local User",
    };
    const { useCase } = makeUseCase();
    const result = await useCase.execute({
      command: {
        displayName: "Workspace",
        ownerActorRef: actor,
        createdByActorRef: actor,
        initialSettings: { defaultIncludeSystemFoundationAssets: false },
      },
      now,
      generateWorkspaceId: () => workspaceId,
    });

    assert.equal(result.workspace?.status, "active");
    assert.equal(result.workspace?.createdAt, timestamp);
    assert.equal(result.workspace?.updatedAt, timestamp);
    assert.deepEqual(result.workspace?.storageRoot, { kind: "host-managed" });
    assert.deepEqual(result.workspace?.ownerActorRef, actor);
    assert.deepEqual(result.workspace?.createdByActorRef, actor);
    assert.equal(
      result.workspace?.settings?.defaultIncludeSystemFoundationAssets,
      true,
    );
    for (const forbidden of [
      "artifacts",
      "images",
      "models",
      "datasets",
      "resources",
      "assetDefinitions",
      "definitions",
      "manifest",
      "path",
    ]) {
      assert.equal(forbidden in (result.workspace ?? {}), false, forbidden);
    }
  });

  it("activates the current system.foundation release by reference by default", async () => {
    const { useCase, activationRepository } = makeUseCase();
    const result = await useCase.execute({
      command: { displayName: "Workspace" },
      now,
      generateWorkspaceId: () => workspaceId,
    });
    const activation = result.systemPackActivations[0];

    assert.equal(result.status, "created");
    assert.equal(activation?.workspaceId, workspaceId);
    assert.equal(activation?.packId, SYSTEM_FOUNDATION_PACK_ID);
    assert.equal(
      activation?.packVersion,
      SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
    );
    assert.equal(activation?.sourceKind, "system");
    assert.equal(activation?.sourceLayer, "system-default");
    assert.equal(activation?.trustStatus, "system-trusted");
    assert.equal(activation?.status, "active");
    assert.equal(activation?.activatedAt, timestamp);
    assert.equal(activationRepository.activations.length, 1);
    for (const forbidden of [
      "manifest",
      "assets",
      "definitions",
      "assetDefinitions",
      "entries",
      "bytes",
      "base64",
    ]) {
      assert.equal(forbidden in (activation ?? {}), false, forbidden);
    }
  });

  it("does not activate system foundation assets when explicitly disabled", async () => {
    const { useCase, activationRepository, workspaceRepository } =
      makeUseCase();
    const result = await useCase.execute({
      command: {
        displayName: "Empty Workspace",
        includeSystemFoundationAssets: false,
      },
      now,
      generateWorkspaceId: () => workspaceId,
    });

    assert.equal(result.status, "created");
    assert.equal(workspaceRepository.records.has(workspaceId), true);
    assert.deepEqual(result.systemPackActivations, []);
    assert.deepEqual(activationRepository.activations, []);
  });

  it("persists active workspace selection only when explicitly requested", async () => {
    const explicit = makeUseCase();
    const explicitResult = await explicit.useCase.execute({
      command: { displayName: "Workspace" },
      now,
      generateWorkspaceId: () => workspaceId,
      selectAfterCreate: true,
    });
    assert.equal(explicitResult.status, "created");
    assert.deepEqual(explicitResult.activeSelection, {
      workspaceId,
      selectedAt: timestamp,
    });
    assert.deepEqual(explicit.selectionRepository.selection, {
      workspaceId,
      selectedAt: timestamp,
    });

    const implicit = makeUseCase();
    const implicitResult = await implicit.useCase.execute({
      command: { displayName: "Workspace" },
      now,
      generateWorkspaceId: () => workspaceId,
    });
    assert.equal(implicitResult.status, "created");
    assert.equal(implicit.selectionRepository.saveCalls, 0);
    assert.equal(implicitResult.activeSelection, undefined);
  });

  it("returns safe failures for workspace, activation, and selection persistence", async () => {
    const workspaceFailure = makeUseCase();
    workspaceFailure.workspaceRepository.failSave = true;
    const workspaceResult = await workspaceFailure.useCase.execute({
      command: { displayName: "Workspace" },
      now,
      generateWorkspaceId: () => workspaceId,
    });
    assert.equal(workspaceResult.status, "failed");
    assert.equal(workspaceResult.issues.at(-1)?.code, "workspace-save-failed");
    assertSafeDiagnostics(workspaceResult);

    const activationFailure = makeUseCase();
    activationFailure.activationRepository.failSave = true;
    const activationResult = await activationFailure.useCase.execute({
      command: { displayName: "Workspace" },
      now,
      generateWorkspaceId: () => workspaceId,
    });
    assert.equal(activationResult.status, "failed");
    assert.equal(activationResult.workspace?.workspaceId, workspaceId);
    assert.equal(
      activationFailure.workspaceRepository.records.has(workspaceId),
      true,
    );
    assert.equal(activationFailure.activationRepository.activations.length, 0);
    assert.equal(activationFailure.selectionRepository.saveCalls, 0);
    assert.equal(activationResult.activeSelection, undefined);
    assert.deepEqual(activationResult.systemPackActivations, []);
    assert.equal(
      activationResult.issues.at(-1)?.code,
      "workspace-system-pack-activation-save-failed",
    );
    assert.equal(
      activationResult.diagnostics.some(
        (diagnostic) =>
          diagnostic.message.includes("Workspace exists") &&
          diagnostic.message.includes("activation reference was not persisted"),
      ),
      true,
    );
    assert.notEqual(
      activationResult.issues.at(-1)?.code,
      workspaceResult.issues.at(-1)?.code,
    );
    assertSafeDiagnostics(activationResult);

    const selectionFailure = makeUseCase();
    selectionFailure.selectionRepository.failSave = true;
    const selectionResult = await selectionFailure.useCase.execute({
      command: { displayName: "Workspace" },
      now,
      generateWorkspaceId: () => workspaceId,
      selectAfterCreate: true,
    });
    assert.equal(selectionResult.status, "failed");
    assert.equal(selectionResult.workspace?.workspaceId, workspaceId);
    assert.equal(selectionResult.systemPackActivations.length, 1);
    assert.equal(
      selectionResult.issues.at(-1)?.code,
      "workspace-selection-save-failed",
    );
    assertSafeDiagnostics(selectionResult);
  });

  it("does not overwrite duplicate generated workspace ids and allows duplicate display names", async () => {
    const duplicateRepo = new FakeWorkspaceRepository();
    duplicateRepo.records.set(workspaceId, {
      workspaceId,
      displayName: "Existing",
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const duplicateResult = await makeUseCase({
      workspaceRepository: duplicateRepo,
    }).useCase.execute({
      command: { displayName: "Existing" },
      now,
      generateWorkspaceId: () => workspaceId,
    });
    assert.equal(duplicateResult.status, "failed");
    assert.equal(duplicateResult.issues[0]?.code, "workspace-already-exists");
    assert.equal(
      duplicateRepo.records.get(workspaceId)?.displayName,
      "Existing",
    );

    const first = makeUseCase();
    const firstResult = await first.useCase.execute({
      command: {
        displayName: "Same Name",
        includeSystemFoundationAssets: false,
      },
      now,
      generateWorkspaceId: () => workspaceId,
    });
    const secondResult = await first.useCase.execute({
      command: {
        displayName: "Same Name",
        includeSystemFoundationAssets: false,
      },
      now,
      generateWorkspaceId: () => otherWorkspaceId,
    });
    assert.equal(firstResult.status, "created");
    assert.equal(secondResult.status, "created");
    assert.notEqual(
      firstResult.workspace?.workspaceId,
      secondResult.workspace?.workspaceId,
    );
  });

  it("keeps the use case boundary free of adapters, hosts, UI, transports, filesystem behavior, installers, and resource directory creation", () => {
    const source = [
      "modules/application/use-cases/workspace/create-workspace.use-case.ts",
      "modules/application/use-cases/workspace/workspace-create-policy.ts",
      "modules/application/use-cases/workspace/workspace-use-case-diagnostics.ts",
      "modules/application/use-cases/workspace/index.ts",
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
      /mkdir|writeFile|artifact|image|dataset|model|page gating|effective view/i,
    );
  });
});
