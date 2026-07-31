import type {
  AssetDefinition,
  AssetPackAssetEntry,
  AssetPackManifest,
  AssetPackOverrideRule,
  AssetReference,
} from "../../../../../contracts/asset";
import { normalizeAssetPackId } from "../../../../../contracts/asset";
import {
  createAssetPackEntryFingerprint,
  createAssetPackManifestFingerprint,
} from "../../asset-pack-fingerprint.service";
import { createAssetPackManifest } from "../../asset-pack-manifest-builder.service";
import { SYSTEM_FOUNDATION_PACK_MANIFEST } from "../../system-packs";

const FIXTURE_VERSION = "1.0.0";

export function createSystemFoundationManifestFixture(): AssetPackManifest {
  return structuredClone(SYSTEM_FOUNDATION_PACK_MANIFEST);
}

export function createUserOverridePackManifestFixture(): AssetPackManifest {
  return createOverridePackFixture({
    packId: "user.demo.ui-overrides",
    displayName: "Demo UI Overrides",
    sourceKind: "user",
    sourceLayer: "user-override",
    trustStatus: "unverified",
    replacementDefinitionId: "user.demo.ui-overrides.panel",
    replacementDisplayName: "Demo Override Panel",
    entryId: "user.demo.ui-overrides.panel",
    ruleId: "user.demo.ui-overrides.panel-rule",
    scope: "user",
  });
}

export function createImportedPackManifestFixture(): AssetPackManifest {
  return createOverridePackFixture({
    packId: "imported.demo.ui-overrides",
    displayName: "Imported Demo UI Overrides",
    sourceKind: "imported",
    sourceLayer: "imported-pack",
    trustStatus: "unverified",
    replacementDefinitionId: "imported.demo.ui-overrides.panel",
    replacementDisplayName: "Imported Override Panel",
    entryId: "imported.demo.ui-overrides.panel",
    ruleId: "imported.demo.ui-overrides.panel-rule",
    scope: "workspace",
  });
}

export function createUnsafePackManifestFixture(): AssetPackManifest {
  return {
    ...createImportedPackManifestFixture(),
    metadata: {
      apiKey: "token=hidden",
    },
  };
}

export function createConflictingOverridePackManifestFixture(): AssetPackManifest {
  const base = createImportedPackManifestFixture();
  const secondEntry = createReplacementEntry({
    baseEntry: SYSTEM_FOUNDATION_PACK_MANIFEST.assets[1] ?? SYSTEM_FOUNDATION_PACK_MANIFEST.assets[0]!,
    definitionId: "imported.demo.ui-overrides.panel-alt",
    displayName: "Imported Alternate Panel",
    entryId: "imported.demo.ui-overrides.panel-alt",
    sourceLayer: "imported-pack",
    packId: base.packId,
  });
  const targetRef = SYSTEM_FOUNDATION_PACK_MANIFEST.assets[0]!.definitionRef;
  const secondRule: AssetPackOverrideRule = {
    ruleId: "imported.demo.ui-overrides.panel-rule-alt",
    targetRef,
    replacementRef: secondEntry.definitionRef,
    scope: "workspace",
    sourceLayer: "imported-pack",
    priority: 100,
    enabled: true,
    conflictPolicy: "report-conflict",
    reason: "Fixture demonstrates a deterministic future override conflict.",
    createdByPackRef: {
      packId: base.packId,
      version: base.version,
    },
    metadata: {
      fixtureOnly: true,
      expectedDiagnostic: "override-conflict",
    },
  };

  return withManifestFingerprint({
    ...base,
    assets: [...base.assets, secondEntry],
    overrideRules: [...(base.overrideRules ?? []), secondRule],
  });
}

function createOverridePackFixture(input: {
  readonly packId: string;
  readonly displayName: string;
  readonly sourceKind: AssetPackManifest["sourceKind"];
  readonly sourceLayer: AssetPackManifest["sourceLayer"];
  readonly trustStatus: AssetPackManifest["trustStatus"];
  readonly replacementDefinitionId: string;
  readonly replacementDisplayName: string;
  readonly entryId: string;
  readonly ruleId: string;
  readonly scope: AssetPackOverrideRule["scope"];
}): AssetPackManifest {
  const packId = normalizeAssetPackId(input.packId);
  const targetEntry = SYSTEM_FOUNDATION_PACK_MANIFEST.assets[0]!;
  const replacementEntry = createReplacementEntry({
    baseEntry: targetEntry,
    definitionId: input.replacementDefinitionId,
    displayName: input.replacementDisplayName,
    entryId: input.entryId,
    sourceLayer: input.sourceLayer,
    packId,
  });
  const overrideRule: AssetPackOverrideRule = {
    ruleId: input.ruleId,
    targetRef: targetEntry.definitionRef,
    replacementRef: replacementEntry.definitionRef,
    scope: input.scope,
    sourceLayer: input.sourceLayer,
    priority: 100,
    enabled: true,
    conflictPolicy: "prefer-replacement",
    reason: "Fixture demonstrates a future non-mutating override.",
    createdByPackRef: {
      packId,
      version: FIXTURE_VERSION,
    },
    metadata: {
      fixtureOnly: true,
      mutatesSystemFoundation: false,
    },
  };

  return withManifestFingerprint(
    createAssetPackManifest({
      schemaVersion: "asset-pack-manifest.v1",
      packId,
      version: FIXTURE_VERSION,
      displayName: input.displayName,
      description:
        "Safe in-memory fixture manifest for future pack sharing readiness tests.",
      publisher: "Demo Fixture Publisher",
      license: {
        kind: "permissive",
        name: "Fixture License",
        url: "https://example.test/fixture-license",
        metadata: {
          fixtureOnly: true,
        },
      },
      sourceKind: input.sourceKind,
      sourceLayer: input.sourceLayer,
      trustStatus: input.trustStatus,
      compatibility: {
        schemaVersion: "asset-pack-compatibility.v1",
        assetKernelVersion: "5.0.0",
        requiresAssetTypes: [replacementEntry.definition.assetType],
        requiresAssetFamilies: [replacementEntry.definition.assetFamily],
        metadata: {
          fixtureOnly: true,
        },
      },
      dependencies: [
        {
          packId: SYSTEM_FOUNDATION_PACK_MANIFEST.packId,
          versionRange: "^1.0.0",
          reason: "Depends on system foundation definition references.",
          metadata: {
            fixtureOnly: true,
          },
        },
      ],
      assets: [replacementEntry],
      overrideRules: [overrideRule],
      tags: ["fixture", "override"],
      categories: [replacementEntry.category],
      metadata: {
        fixtureOnly: true,
        importReadinessOnly: true,
        productSurface: "deferred",
      },
    }),
  );
}

function createReplacementEntry(input: {
  readonly baseEntry: AssetPackAssetEntry;
  readonly definitionId: string;
  readonly displayName: string;
  readonly entryId: string;
  readonly sourceLayer: AssetPackManifest["sourceLayer"];
  readonly packId: string;
}): AssetPackAssetEntry {
  const definitionId = input.definitionId as AssetDefinition["definitionId"];
  const definitionRef: AssetReference = {
    kind: "asset-definition-version",
    id: definitionId as AssetReference["id"],
    version: FIXTURE_VERSION,
  };
  const definition: AssetDefinition = {
    ...structuredClone(input.baseEntry.definition),
    definitionId,
    version: FIXTURE_VERSION,
    displayName: input.displayName,
    description:
      "Fixture-only semantic replacement definition for import readiness tests.",
    provenance: {
      sourceKind: "imported",
      authorship: "human-authored",
      sourceAssetRefs: [input.baseEntry.definitionRef],
      metadata: {
        sourcePackId: input.packId,
        sourcePackVersion: FIXTURE_VERSION,
        categoryId: input.baseEntry.category,
        fixtureOnly: true,
      },
    },
    metadata: {
      categoryId: input.baseEntry.category,
      sourcePackId: input.packId,
      sourcePackVersion: FIXTURE_VERSION,
      sourceLayer: input.sourceLayer,
      fixtureOnly: true,
      descriptorOnly: true,
    },
  };
  const entryWithoutFingerprint: Omit<AssetPackAssetEntry, "fingerprint"> = {
    entryId: input.entryId,
    definition,
    definitionRef,
    category: input.baseEntry.category,
    sourceLayer: input.sourceLayer,
    tags: ["fixture", "override"],
    metadata: {
      sourcePack: {
        packId: input.packId,
        version: FIXTURE_VERSION,
      },
      categoryId: input.baseEntry.category,
      fixtureOnly: true,
      descriptorOnly: true,
    },
  };

  return {
    ...entryWithoutFingerprint,
    fingerprint: createAssetPackEntryFingerprint(
      entryWithoutFingerprint as AssetPackAssetEntry,
    ),
  };
}

function withManifestFingerprint(manifest: AssetPackManifest): AssetPackManifest {
  return {
    ...manifest,
    checksum: createAssetPackManifestFingerprint(manifest),
  };
}
