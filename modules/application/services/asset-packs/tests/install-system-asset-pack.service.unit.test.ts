import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { AssetComposition, AssetDefinition, AssetInstance, AssetPackManifest, AssetReference } from "../../../../contracts/asset";
import type { AssetCompositionListQuery, AssetCompositionRepositoryPort, AssetDefinitionListQuery, AssetDefinitionRepositoryPort, AssetInstanceListQuery, AssetInstanceRepositoryPort } from "../../../ports/asset";
import { AssetRegistryReadFacade } from "../../asset";
import { mapAssetDefinitionCard } from "../../../../ui/shared/asset-library";
import { InstallSystemAssetPackService } from "../install-system-asset-pack.service";
import { SYSTEM_FOUNDATION_PACK_ID, SYSTEM_FOUNDATION_PACK_MANIFEST } from "../system-packs";

class MemoryDefinitionRepository implements AssetDefinitionRepositoryPort {
  public saveCount = 0;
  public getCount = 0;
  public throwOnSave = false;
  public throwOnGet = false;
  private readonly definitions = new Map<string, AssetDefinition>();

  public async saveDefinition(definition: AssetDefinition): Promise<AssetDefinition> {
    this.saveCount += 1;
    if (this.throwOnSave) throw new Error("C:\\tmp\\raw token stack providerPayload");
    this.definitions.set(keyForDefinition(definition), structuredClone(definition));
    return structuredClone(definition);
  }

  public async getDefinition(reference: AssetReference): Promise<AssetDefinition | undefined> {
    this.getCount += 1;
    if (this.throwOnGet) throw new Error("C:\\tmp\\raw token stack providerPayload");
    const version = reference.version;
    if (version) return cloneOrUndefined(this.definitions.get(`${reference.id}@${version}`));
    const matches = [...this.definitions.values()].filter((definition) => definition.definitionId === reference.id);
    return cloneOrUndefined(matches[matches.length - 1]);
  }

  public async listDefinitions(_query: AssetDefinitionListQuery = {}) {
    return { definitions: [...this.definitions.values()].map((definition) => structuredClone(definition)) };
  }
}

class EmptyInstanceRepository implements AssetInstanceRepositoryPort {
  public async saveInstance(instance: AssetInstance): Promise<AssetInstance> { return instance; }
  public async getInstance(_reference: AssetReference): Promise<AssetInstance | undefined> { return undefined; }
  public async listInstances(_query: AssetInstanceListQuery = {}) { return { instances: [] }; }
  public async deleteInstance(_reference: AssetReference): Promise<void> {}
}

class EmptyCompositionRepository implements AssetCompositionRepositoryPort {
  public async saveComposition(composition: AssetComposition): Promise<AssetComposition> { return composition; }
  public async getComposition(_reference: AssetReference): Promise<AssetComposition | undefined> { return undefined; }
  public async listCompositions(_query: AssetCompositionListQuery = {}) { return { compositions: [] }; }
  public async deleteComposition(_reference: AssetReference): Promise<void> {}
}

const now = () => new Date("2026-05-09T12:00:00.000Z");

describe("InstallSystemAssetPackService", () => {
  it("validate-only mode validates the manifest and persists nothing", async () => {
    const repository = new MemoryDefinitionRepository();
    const result = await service(repository).install({
      manifest: singleEntryManifest(),
      mode: "validate-only",
      expectedPackId: SYSTEM_FOUNDATION_PACK_ID,
      now,
    });

    assert.equal(result.status, "validated");
    assert.equal(result.checkedEntryCount, 1);
    assert.equal(result.installedEntryCount, 0);
    assert.equal(repository.saveCount, 0);
    assert.equal(repository.getCount, 0);
  });

  it("validates manifest identity before persisting", async () => {
    const repository = new MemoryDefinitionRepository();
    const result = await service(repository).install({
      manifest: { ...singleEntryManifest(), packId: "workspace.foundation" as never },
      expectedPackId: SYSTEM_FOUNDATION_PACK_ID,
      now,
    });

    assert.equal(result.status, "failed");
    assert.equal(repository.saveCount, 0);
    assert.match(messages(result), /expected system pack ID/i);
  });

  it("invalid manifests block all writes", async () => {
    const repository = new MemoryDefinitionRepository();
    const result = await service(repository).install({
      manifest: { ...singleEntryManifest(), categories: ["ui-structure", "ui-structure"] },
      expectedPackId: SYSTEM_FOUNDATION_PACK_ID,
      now,
    });

    assert.equal(result.status, "failed");
    assert.equal(repository.saveCount, 0);
    assert.match(messages(result), /unique/i);
  });

  it("invalid asset definitions block all writes", async () => {
    const repository = new MemoryDefinitionRepository();
    const manifest = withFirstDefinition({ displayName: "" });
    const result = await service(repository).install({
      manifest,
      expectedPackId: SYSTEM_FOUNDATION_PACK_ID,
      now,
    });

    assert.equal(result.status, "failed");
    assert.equal(repository.saveCount, 0);
    assert.match(messages(result), /display name/i);
  });

  it("quality-gate errors block all writes", async () => {
    const repository = new MemoryDefinitionRepository();
    const manifest = withFirstDefinition({
      description: "This primitive will execute workflow runs.",
    });
    const result = await service(repository).install({
      manifest,
      expectedPackId: SYSTEM_FOUNDATION_PACK_ID,
      now,
    });

    assert.equal(result.status, "failed");
    assert.equal(repository.saveCount, 0);
    assert.match(messages(result), /unsafe implementation|execution behavior/i);
  });

  it("installs valid system foundation entries with safe definition refs", async () => {
    const repository = new MemoryDefinitionRepository();
    const result = await service(repository).install({
      manifest: singleEntryManifest(),
      expectedPackId: SYSTEM_FOUNDATION_PACK_ID,
      now,
    });

    assert.equal(result.status, "installed");
    assert.equal(result.checkedEntryCount, 1);
    assert.equal(result.installedEntryCount, 1);
    assert.deepEqual(result.installedDefinitionRefs, [
      {
        kind: "asset-definition-version",
        id: singleEntryManifest().assets[0]!.definitionRef.id,
        version: singleEntryManifest().assets[0]!.definitionRef.version,
      },
    ]);
    assert.equal(repository.saveCount, 1);
    assert.doesNotMatch(JSON.stringify(result), /(?:C:\\|\/tmp|token|secret|providerPayload|stack|base64|bytes|command)/i);
  });

  it("writes metadata that the read facade and shared UI treat as system default", async () => {
    const repository = new MemoryDefinitionRepository();
    const result = await service(repository).install({
      manifest: singleEntryManifest(),
      expectedPackId: SYSTEM_FOUNDATION_PACK_ID,
      now,
    });
    const saved = (await repository.listDefinitions()).definitions[0]!;
    const marker = saved.metadata?.assetPackInstall as Record<string, unknown> | undefined;
    const facade = new AssetRegistryReadFacade({
      definitionRepository: repository,
      instanceRepository: new EmptyInstanceRepository(),
      compositionRepository: new EmptyCompositionRepository(),
    });
    const card = (await facade.listDefinitionCards()).items[0]!;
    const uiCard = mapAssetDefinitionCard(card);

    assert.equal(result.status, "installed");
    assert.deepEqual(marker, {
      packId: "system.foundation",
      packVersion: "1.0.0",
      entryId: singleEntryManifest().assets[0]!.entryId,
      fingerprint: singleEntryManifest().assets[0]!.fingerprint,
      sourceKind: "system",
      sourceLayer: "system-default",
      trustStatus: "system-trusted",
      managedBy: "asset-kernel",
      installedAt: "2026-05-09T12:00:00.000Z",
    });
    assert.equal(card.builtIn, true);
    assert.equal(card.systemDefault, true);
    assert.equal(uiCard.systemDefault, true);
    assert.equal(uiCard.sourceBadgeLabel, "System default");
  });

  it("reinstall is idempotent and does not create duplicate records", async () => {
    const repository = new MemoryDefinitionRepository();
    const installer = service(repository);

    const first = await installer.install({
      manifest: singleEntryManifest(),
      expectedPackId: SYSTEM_FOUNDATION_PACK_ID,
      now,
    });
    const second = await installer.install({
      manifest: singleEntryManifest(),
      expectedPackId: SYSTEM_FOUNDATION_PACK_ID,
      now,
    });

    assert.equal(first.status, "installed");
    assert.equal(second.status, "installed-with-skips");
    assert.equal(second.installedEntryCount, 0);
    assert.equal(second.skippedEntryCount, 1);
    assert.equal(repository.saveCount, 1);
    assert.equal((await repository.listDefinitions()).definitions.length, 1);
    assert.match(JSON.stringify(second.diagnostics), /definition-already-installed/);
  });

  it("fails on existing user or custom definitions with the same ID and version", async () => {
    const repository = new MemoryDefinitionRepository();
    const entry = singleEntryManifest().assets[0];
    assert.ok(entry);
    await repository.saveDefinition({
      ...entry.definition,
      displayName: "User Modified Definition",
      metadata: { userOwned: true },
      provenance: { sourceKind: "human-authored", authorship: "human-authored" },
    });
    repository.saveCount = 0;

    const result = await service(repository).install({
      manifest: singleEntryManifest(),
      expectedPackId: SYSTEM_FOUNDATION_PACK_ID,
      now,
    });
    const saved = await repository.getDefinition(entry.definitionRef);

    assert.equal(result.status, "failed");
    assert.equal(result.failedEntryCount, 1);
    assert.equal(result.skippedEntryCount, 0);
    assert.equal(repository.saveCount, 0);
    assert.equal(saved?.displayName, "User Modified Definition");
    assert.match(messages(result), /conflicts with the system pack entry/i);
    assert.equal(result.issues.some((issue) => issue.severity === "error"), true);
    assert.match(JSON.stringify(result.diagnostics), /definition-conflict-not-overwritten/);
    assert.doesNotMatch(JSON.stringify(result), /(?:C:\\|\/tmp|token|secret|providerPayload|stack|base64|bytes|command)/i);
  });

  it("does not save later entries after a user or custom conflict", async () => {
    const repository = new MemoryDefinitionRepository();
    const manifest = {
      ...SYSTEM_FOUNDATION_PACK_MANIFEST,
      assets: SYSTEM_FOUNDATION_PACK_MANIFEST.assets.slice(0, 2),
      categories: Array.from(new Set(SYSTEM_FOUNDATION_PACK_MANIFEST.assets.slice(0, 2).map((entry) => entry.category))),
    };
    const conflictingEntry = manifest.assets[0]!;
    const laterEntry = manifest.assets[1]!;
    await repository.saveDefinition({
      ...conflictingEntry.definition,
      displayName: "User Modified Definition",
      metadata: { userOwned: true },
      provenance: { sourceKind: "human-authored", authorship: "human-authored" },
    });
    repository.saveCount = 0;

    const result = await service(repository).install({
      manifest,
      expectedPackId: SYSTEM_FOUNDATION_PACK_ID,
      now,
    });

    assert.equal(result.status, "failed");
    assert.equal(result.failedEntryCount, 1);
    assert.equal(repository.saveCount, 0);
    assert.equal((await repository.getDefinition(conflictingEntry.definitionRef))?.displayName, "User Modified Definition");
    assert.equal(await repository.getDefinition(laterEntry.definitionRef), undefined);
  });

  it("skips existing system-owned same-pack definitions by default", async () => {
    const repository = new MemoryDefinitionRepository();
    const installer = service(repository);
    await installer.install({ manifest: singleEntryManifest(), expectedPackId: SYSTEM_FOUNDATION_PACK_ID, now });
    repository.saveCount = 0;

    const result = await installer.install({
      manifest: singleEntryManifest(),
      expectedPackId: SYSTEM_FOUNDATION_PACK_ID,
      now,
    });

    assert.equal(result.status, "installed-with-skips");
    assert.equal(result.skippedEntryCount, 1);
    assert.equal(repository.saveCount, 0);
  });

  it("refreshes same-pack system-owned definitions only when explicitly enabled", async () => {
    const repository = new MemoryDefinitionRepository();
    const installer = service(repository);
    await installer.install({ manifest: singleEntryManifest(), expectedPackId: SYSTEM_FOUNDATION_PACK_ID, now });
    repository.saveCount = 0;

    const changed = {
      ...singleEntryManifest(),
      assets: [
        {
          ...singleEntryManifest().assets[0]!,
          fingerprint: "fnv1a:ffffffff",
          definition: {
            ...singleEntryManifest().assets[0]!.definition,
            displayName: "Refreshed Definition",
          },
        },
      ],
    };

    const skipped = await installer.install({
      manifest: changed,
      expectedPackId: SYSTEM_FOUNDATION_PACK_ID,
      now,
    });
    const refreshed = await installer.install({
      manifest: changed,
      expectedPackId: SYSTEM_FOUNDATION_PACK_ID,
      allowSystemDefinitionRefresh: true,
      now,
    });

    assert.equal(skipped.status, "failed");
    assert.equal(skipped.failedEntryCount, 1);
    assert.equal(repository.saveCount, 1);
    assert.equal(refreshed.status, "installed");
    assert.equal((await repository.getDefinition(changed.assets[0]!.definitionRef))?.displayName, "Refreshed Definition");
  });

  it("returns safe diagnostics for raw persistence failures", async () => {
    const repository = new MemoryDefinitionRepository();
    repository.throwOnSave = true;

    const result = await service(repository).install({
      manifest: singleEntryManifest(),
      expectedPackId: SYSTEM_FOUNDATION_PACK_ID,
      now,
    });

    assert.equal(result.status, "failed");
    assert.equal(result.failedEntryCount, 1);
    assert.doesNotMatch(JSON.stringify(result), /(?:C:\\|\/tmp|token|secret|providerPayload|stack|raw|base64|bytes|command)/i);
  });

  it("imports no adapters, hosts, UI, API, IPC, preload, runtime, provider, filesystem, or network modules", () => {
    const source = readFileSync(
      join(process.cwd(), "modules/application/services/asset-packs/install-system-asset-pack.service.ts"),
      "utf8",
    );

    assert.doesNotMatch(source, /from\s+["'][^"']*(?:adapters\/|hosts\/|modules\/ui|contracts\/api|contracts\/ipc|api-express|ipc-electron|electron|express|preload|renderer|thin-client|runtime\/|provider-client|huggingface|openai|node:fs|node:path|node:http|node:https)[^"']*["']/i);
    assert.doesNotMatch(source, /\b(?:readFile|writeFile|readdir|opendir|glob|fetch\(|startRuntime|probeRuntime|installRuntime|repairRuntime|readBytes|readResourceBytes)\b/i);
  });
});

function service(repository: AssetDefinitionRepositoryPort): InstallSystemAssetPackService {
  return new InstallSystemAssetPackService({ definitionRepository: repository });
}

function singleEntryManifest(): AssetPackManifest {
  return {
    ...SYSTEM_FOUNDATION_PACK_MANIFEST,
    assets: [SYSTEM_FOUNDATION_PACK_MANIFEST.assets[0]!],
    categories: [SYSTEM_FOUNDATION_PACK_MANIFEST.assets[0]!.category],
  };
}

function withFirstDefinition(overrides: Partial<AssetDefinition>): AssetPackManifest {
  const manifest = singleEntryManifest();
  const first = manifest.assets[0]!;
  return {
    ...manifest,
    assets: [
      {
        ...first,
        definition: {
          ...first.definition,
          ...overrides,
        },
      },
    ],
  };
}

function keyForDefinition(definition: AssetDefinition): string {
  return `${definition.definitionId}@${definition.version}`;
}

function cloneOrUndefined(definition: AssetDefinition | undefined): AssetDefinition | undefined {
  return definition ? structuredClone(definition) : undefined;
}

function messages(result: { readonly issues: readonly { readonly message: string }[] }): string {
  return result.issues.map((issue) => issue.message).join("\n");
}
