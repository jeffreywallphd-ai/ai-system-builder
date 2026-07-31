import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { normalizeAssetPackId } from "../../../../contracts/asset";
import {
  createWorkspaceId,
  type WorkspaceId,
  type WorkspaceSystemPackActivation,
} from "../../../../contracts/workspace";
import type { WorkspaceSystemPackActivationRepository } from "../../../ports/workspace";
import {
  createSystemFoundationWorkspaceActivation,
  SetWorkspaceSystemPackActivationStatusUseCase,
} from "..";

const workspaceId = createWorkspaceId("workspace.activation-status");
const timestamp = "2026-05-14T00:00:00.000Z";
const updatedAt = "2026-05-14T01:00:00.000Z";

class FakeActivationRepository implements WorkspaceSystemPackActivationRepository {
  public activations: WorkspaceSystemPackActivation[] = [];
  public failRead = false;
  public failUpdate = false;
  public updateCalls = 0;
  public saveCalls = 0;

  public async listWorkspaceSystemPackActivations(id: WorkspaceId): Promise<readonly WorkspaceSystemPackActivation[]> {
    return this.activations.filter((activation) => activation.workspaceId === id);
  }

  public async readWorkspaceSystemPackActivation(
    id: WorkspaceId,
    activationId: string,
  ): Promise<WorkspaceSystemPackActivation | undefined> {
    if (this.failRead) throw new Error("/private/path SECRET_TOKEN stack trace curl http://localhost env base64");
    return this.activations.find((activation) => activation.workspaceId === id && activation.activationId === activationId);
  }

  public async saveWorkspaceSystemPackActivation(activation: WorkspaceSystemPackActivation): Promise<void> {
    this.saveCalls += 1;
    this.activations.push(activation);
  }

  public async updateWorkspaceSystemPackActivation(activation: WorkspaceSystemPackActivation): Promise<void> {
    this.updateCalls += 1;
    if (this.failUpdate) throw new Error("/private/path SECRET_TOKEN stack trace curl http://localhost env base64");
    const index = this.activations.findIndex((candidate) => candidate.workspaceId === activation.workspaceId && candidate.activationId === activation.activationId);
    if (index < 0) throw new Error("missing /private/path SECRET_TOKEN stack trace");
    this.activations[index] = activation;
  }
}

function makeActivation(overrides: Partial<WorkspaceSystemPackActivation> = {}): WorkspaceSystemPackActivation {
  return {
    ...createSystemFoundationWorkspaceActivation(workspaceId, timestamp),
    ...overrides,
  };
}

function makeUseCase(repository = new FakeActivationRepository()): { repository: FakeActivationRepository; useCase: SetWorkspaceSystemPackActivationStatusUseCase } {
  return {
    repository,
    useCase: new SetWorkspaceSystemPackActivationStatusUseCase({ systemPackActivationRepository: repository }),
  };
}

function assertSafe(value: unknown): void {
  assert.doesNotMatch(JSON.stringify(value), /SECRET|TOKEN|private|\/tmp|\/Users|C:\\|stack|curl|env|base64|localhost/i);
}

function assertReferenceOnly(value: unknown): void {
  assert.doesNotMatch(JSON.stringify(value), /assetDefinitions|definitions|entries|manifest|contents|bytes|base64|resourceBytes/i);
}

describe("SetWorkspaceSystemPackActivationStatusUseCase", () => {
  it("updates an existing active activation to inactive", async () => {
    const { repository, useCase } = makeUseCase();
    const activation = makeActivation();
    repository.activations.push(activation);

    const result = await useCase.execute({ workspaceId, activationId: activation.activationId, status: "inactive", updatedAt });

    assert.equal(result.status, "updated");
    assert.equal(result.activation?.status, "inactive");
    assert.equal(repository.updateCalls, 1);
    assert.equal(repository.saveCalls, 0);
    assert.deepEqual(repository.activations[0], { ...activation, status: "inactive" });
    assertReferenceOnly(result);
  });

  it("updates an existing inactive activation to active", async () => {
    const { repository, useCase } = makeUseCase();
    const activation = makeActivation({ status: "inactive" });
    repository.activations.push(activation);

    const result = await useCase.execute({ workspaceId, activationId: activation.activationId, status: "active", updatedAt });

    assert.equal(result.status, "updated");
    assert.equal(result.activation?.status, "active");
    assert.equal(repository.activations[0]?.status, "active");
  });

  it("fails safely when the activation is missing and does not create it", async () => {
    const { repository, useCase } = makeUseCase();

    const result = await useCase.execute({ workspaceId, activationId: "activation.missing", status: "inactive", updatedAt });

    assert.equal(result.status, "failed");
    assert.equal(result.issues[0]?.code, "workspace-system-pack-activation-not-found");
    assert.equal(repository.updateCalls, 0);
    assert.equal(repository.saveCalls, 0);
    assert.deepEqual(repository.activations, []);
    assertSafe(result);
  });

  it("does not update unknown pack activations or invalid provenance records", async () => {
    const unknownRepo = new FakeActivationRepository();
    unknownRepo.activations.push(makeActivation({ activationId: "activation.unknown", packId: normalizeAssetPackId("system.unknown") }));
    const unknownResult = await makeUseCase(unknownRepo).useCase.execute({ workspaceId, activationId: "activation.unknown", status: "active", updatedAt });
    assert.equal(unknownResult.status, "failed");
    assert.equal(unknownResult.issues[0]?.code, "workspace-system-pack-activation-unknown-pack");
    assert.equal(unknownRepo.updateCalls, 0);

    const invalidRepo = new FakeActivationRepository();
    invalidRepo.activations.push(makeActivation({ activationId: "activation.invalid", trustStatus: "trusted" as "system-trusted" }));
    const invalidResult = await makeUseCase(invalidRepo).useCase.execute({ workspaceId, activationId: "activation.invalid", status: "active", updatedAt });
    assert.equal(invalidResult.status, "failed");
    assert.equal(invalidResult.issues[0]?.code, "workspace-system-pack-activation-invalid-provenance");
    assert.equal(invalidRepo.updateCalls, 0);
  });

  it("does not allow failed activations or failed status as user-selected updates", async () => {
    const { repository, useCase } = makeUseCase();
    const activation = makeActivation({ status: "failed" });
    repository.activations.push(activation);

    const failedExisting = await useCase.execute({ workspaceId, activationId: activation.activationId, status: "active", updatedAt });
    assert.equal(failedExisting.status, "failed");
    assert.equal(failedExisting.issues[0]?.code, "workspace-system-pack-activation-failed");
    assert.equal(repository.updateCalls, 0);

    const invalidStatus = await useCase.execute({ workspaceId, activationId: activation.activationId, status: "failed" as "active", updatedAt });
    assert.equal(invalidStatus.status, "failed");
    assert.equal(invalidStatus.issues[0]?.code, "workspace-system-pack-activation-status-invalid");
    assert.equal(repository.updateCalls, 0);
  });

  it("returns sanitized diagnostics for read and update failures", async () => {
    const readFailure = makeUseCase();
    readFailure.repository.failRead = true;
    const readResult = await readFailure.useCase.execute({ workspaceId, activationId: "activation.any", status: "inactive", updatedAt });
    assert.equal(readResult.status, "failed");
    assert.equal(readResult.issues[0]?.code, "workspace-system-pack-activation-status-update-failed");
    assertSafe(readResult);

    const updateFailure = makeUseCase();
    const activation = makeActivation();
    updateFailure.repository.activations.push(activation);
    updateFailure.repository.failUpdate = true;
    const updateResult = await updateFailure.useCase.execute({ workspaceId, activationId: activation.activationId, status: "inactive", updatedAt });
    assert.equal(updateResult.status, "failed");
    assert.equal(updateResult.issues[0]?.code, "workspace-system-pack-activation-status-update-failed");
    assertSafe(updateResult);
  });

  it("keeps status update source free of forbidden boundaries and installers", () => {
    const source = [
      "modules/application/use-cases/workspace/set-workspace-system-pack-activation-status.use-case.ts",
      "modules/application/use-cases/workspace/workspace-system-pack-activation-policy.ts",
      "modules/application/use-cases/workspace/workspace-system-pack-activation-diagnostics.ts",
    ].map((relativePath) => readFileSync(join(process.cwd(), relativePath), "utf8")).join("\n");

    assert.doesNotMatch(source, /from\s+["'][^"']*(?:adapters|hosts|apps|ui|api|ipc|preload|renderer|thin-client|provider|runtime|node:fs|node:path)[^"']*["']/i);
    assert.doesNotMatch(source, /InstallSystemAssetPackService|installSystemFoundationPack|install-system-asset-pack|install-system-foundation-pack/);
    assert.doesNotMatch(source, /mkdir|writeFile|artifact|image|dataset|model|AssetLibrary|effective view/i);
  });
});
