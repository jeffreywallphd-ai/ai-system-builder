import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  AssetDefinition,
  AssetReference,
} from "../../../../contracts/asset";
import type { AssetDefinitionRepositoryPort } from "../../../ports/asset";
import {
  InstallSystemFoundationPackService,
  installSystemFoundationPack,
} from "../install-system-foundation-pack.service";
import {
  SYSTEM_FOUNDATION_PACK_MANIFEST,
  SYSTEM_FOUNDATION_PACK_V2_MANIFEST,
  SYSTEM_FOUNDATION_PACK_VERSIONS,
} from "../system-packs";

class MemoryDefinitionRepository implements AssetDefinitionRepositoryPort {
  private readonly definitions = new Map<string, AssetDefinition>();
  public saveCount = 0;

  public async saveDefinition(
    definition: AssetDefinition,
  ): Promise<AssetDefinition> {
    this.saveCount += 1;
    this.definitions.set(
      `${definition.definitionId}@${definition.version}`,
      structuredClone(definition),
    );
    return structuredClone(definition);
  }

  public async getDefinition(
    reference: AssetReference,
  ): Promise<AssetDefinition | undefined> {
    const definition = this.definitions.get(
      `${reference.id}@${reference.version}`,
    );
    return definition ? structuredClone(definition) : undefined;
  }

  public async listDefinitions() {
    return {
      definitions: [...this.definitions.values()].map((definition) =>
        structuredClone(definition),
      ),
    };
  }
}

const now = () => new Date("2026-05-09T12:00:00.000Z");

describe("InstallSystemFoundationPackService", () => {
  it("uses the canonical system.foundation manifest and expected pack ID", async () => {
    const repository = new MemoryDefinitionRepository();
    const result = await new InstallSystemFoundationPackService({
      definitionRepository: repository,
    }).install({ mode: "validate-only", now });

    assert.equal(result.status, "validated");
    assert.equal(result.packId, "system.foundation");
    assert.equal(result.packVersion, "1.0.0");
    assert.equal(
      result.checkedEntryCount,
      SYSTEM_FOUNDATION_PACK_MANIFEST.assets.length,
    );
    assert.equal(repository.saveCount, 0);
  });

  it("installs all current system foundation entries when explicitly invoked", async () => {
    const repository = new MemoryDefinitionRepository();
    const result = await installSystemFoundationPack(
      { definitionRepository: repository },
      { now },
    );

    assert.equal(result.status, "installed");
    assert.equal(
      result.checkedEntryCount,
      SYSTEM_FOUNDATION_PACK_MANIFEST.assets.length,
    );
    assert.equal(
      result.installedEntryCount,
      SYSTEM_FOUNDATION_PACK_MANIFEST.assets.length,
    );
    assert.equal(
      (await repository.listDefinitions()).definitions.length,
      SYSTEM_FOUNDATION_PACK_MANIFEST.assets.length,
    );
  });

  it("installs an exact 2.0.0 release without rewriting 1.0.0", async () => {
    const repository = new MemoryDefinitionRepository();
    const service = new InstallSystemFoundationPackService({
      definitionRepository: repository,
    });
    const legacy = await service.install({ now });
    const current = await service.install({ version: "2.0.0", now });

    assert.equal(legacy.packVersion, "1.0.0");
    assert.equal(current.packVersion, "2.0.0");
    assert.equal(
      current.installedEntryCount,
      SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets.length,
    );
    assert.equal(
      (await repository.listDefinitions()).definitions.length,
      SYSTEM_FOUNDATION_PACK_MANIFEST.assets.length +
        SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets.length,
    );
  });

  it("installs every immutable Foundation release in version order", async () => {
    const repository = new MemoryDefinitionRepository();
    const results = await new InstallSystemFoundationPackService({
      definitionRepository: repository,
    }).installAll({ now });

    assert.deepEqual(
      results.map((result) => result.packVersion),
      SYSTEM_FOUNDATION_PACK_VERSIONS,
    );
    assert.equal(
      results.every((result) => result.status === "installed"),
      true,
    );
  });

  it("saved definitions retain safe source pack, category, source layer, and fingerprint metadata", async () => {
    const repository = new MemoryDefinitionRepository();
    await installSystemFoundationPack(
      { definitionRepository: repository },
      { now },
    );

    const definitions = (await repository.listDefinitions()).definitions;
    for (const entry of SYSTEM_FOUNDATION_PACK_MANIFEST.assets) {
      const saved = definitions.find(
        (definition) =>
          definition.definitionId === entry.definition.definitionId &&
          definition.version === entry.definition.version,
      );
      assert.ok(saved, entry.entryId);
      assert.equal(
        saved.metadata?.sourcePackId,
        "system.foundation",
        entry.entryId,
      );
      assert.equal(saved.metadata?.sourcePackVersion, "1.0.0", entry.entryId);
      assert.equal(saved.metadata?.categoryId, entry.category, entry.entryId);
      assert.equal(
        saved.metadata?.sourceLayer,
        entry.sourceLayer,
        entry.entryId,
      );
      assert.equal(
        saved.metadata?.sourcePackFingerprint,
        entry.fingerprint,
        entry.entryId,
      );
      assert.deepEqual(
        saved.provenance.metadata?.sourcePackId,
        "system.foundation",
      );

      const installMetadata = saved.metadata?.assetPackInstall as
        | {
            readonly packId?: string;
            readonly packVersion?: string;
            readonly entryId?: string;
            readonly fingerprint?: string;
            readonly sourceLayer?: string;
          }
        | undefined;
      assert.equal(installMetadata?.packId, "system.foundation", entry.entryId);
      assert.equal(installMetadata?.packVersion, "1.0.0", entry.entryId);
      assert.equal(installMetadata?.entryId, entry.entryId, entry.entryId);
      assert.equal(
        installMetadata?.fingerprint,
        entry.fingerprint,
        entry.entryId,
      );
      assert.equal(
        installMetadata?.sourceLayer,
        "system-default",
        entry.entryId,
      );
    }
  });

  it("reinstalled foundation entries are read back as already installed", async () => {
    const repository = new MemoryDefinitionRepository();
    await installSystemFoundationPack(
      { definitionRepository: repository },
      { now },
    );
    repository.saveCount = 0;

    const second = await installSystemFoundationPack(
      { definitionRepository: repository },
      { now },
    );

    assert.equal(second.status, "installed-with-skips");
    assert.equal(second.installedEntryCount, 0);
    assert.equal(
      second.skippedEntryCount,
      SYSTEM_FOUNDATION_PACK_MANIFEST.assets.length,
    );
    assert.equal(repository.saveCount, 0);
    assert.equal(
      (await repository.listDefinitions()).definitions.length,
      SYSTEM_FOUNDATION_PACK_MANIFEST.assets.length,
    );
  });

  it("does not apply override rules or invoke resolver behavior", async () => {
    const repository = new MemoryDefinitionRepository();
    const result = await installSystemFoundationPack(
      { definitionRepository: repository },
      { now },
    );

    assert.deepEqual(SYSTEM_FOUNDATION_PACK_MANIFEST.overrideRules, []);
    assert.equal(JSON.stringify(result).includes("appliedOverrideRule"), false);
    assert.equal(JSON.stringify(result).includes("resolvedDefinition"), false);
  });
});
