import { isDeepStrictEqual, types } from "node:util";
import type {
  AssetDefinition,
  AssetMetadata,
  AssetPackId,
  AssetPackManifest,
  AssetPackVersion,
  AssetReference,
  AssetValidationIssue,
} from "../../../contracts/asset";
import type { AssetDefinitionRepositoryPort } from "../../ports/asset";
import type { AssetUseCaseResult } from "../../use-cases/asset";
import { validateAssetDefinition, type AssetValidationResult } from "../asset";
import { runAssetPackQualityGates } from "./asset-pack-quality-gates.service";
import { captureAssetPackFingerprintInput } from "./asset-pack-fingerprint-input";
import {
  validateAssetPackAssetEntry,
  validateAssetPackManifest,
} from "./asset-pack-validation.service";

export interface InstallSystemAssetPackInput {
  readonly manifest: AssetPackManifest;
  readonly mode?: "validate-only" | "install";
  readonly expectedPackId?: AssetPackId;
  readonly allowSystemDefinitionRefresh?: boolean;
  readonly now?: () => Date;
}

export type InstallSystemAssetPackStatus =
  | "validated"
  | "installed"
  | "installed-with-skips"
  | "failed";

export type AssetPackInstallDiagnosticSeverity = "info" | "warning" | "error";

export interface AssetPackInstallDiagnostic {
  readonly severity: AssetPackInstallDiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly entryId?: string;
  readonly definitionRef?: AssetReference;
  readonly metadata?: AssetMetadata;
}

export interface InstallSystemAssetPackResult {
  readonly status: InstallSystemAssetPackStatus;
  readonly packId: AssetPackId;
  readonly packVersion: AssetPackVersion;
  readonly checkedEntryCount: number;
  readonly installedEntryCount: number;
  readonly skippedEntryCount: number;
  readonly failedEntryCount: number;
  readonly installedDefinitionRefs: readonly AssetReference[];
  readonly skippedDefinitionRefs: readonly AssetReference[];
  readonly issues: readonly AssetValidationIssue[];
  readonly diagnostics: readonly AssetPackInstallDiagnostic[];
}

export interface InstallSystemAssetPackServiceDependencies {
  readonly definitionRepository: AssetDefinitionRepositoryPort;
  readonly registerAssetDefinition?: {
    execute(definition: AssetDefinition): Promise<AssetUseCaseResult<AssetDefinition>>;
    executeMany?(definitions: readonly AssetDefinition[], expected: readonly (AssetDefinition | undefined)[]): Promise<AssetUseCaseResult<readonly AssetDefinition[]>>;
  };
}

type PlannedInstallAction =
  | {
      readonly kind: "install";
      readonly expected?: AssetDefinition;
      readonly entry: AssetPackManifest["assets"][number];
      readonly definition: AssetDefinition;
      readonly definitionRef: AssetReference;
    }
  | {
      readonly kind: "refresh";
      readonly expected: AssetDefinition;
      readonly entry: AssetPackManifest["assets"][number];
      readonly definition: AssetDefinition;
      readonly definitionRef: AssetReference;
    }
  | {
      readonly kind: "skip";
      readonly entry: AssetPackManifest["assets"][number];
      readonly definitionRef: AssetReference;
      readonly diagnostic: AssetPackInstallDiagnostic;
    };

type SystemPackDefinitionMetadata = AssetMetadata & {
  readonly packId: string;
  readonly packVersion: string;
  readonly entryId: string;
  readonly fingerprint: string;
  readonly sourceKind: "system";
  readonly sourceLayer: "system-default";
  readonly trustStatus: "system-trusted";
  readonly managedBy: "asset-kernel";
  readonly installedAt: string;
};

const SAFE_FAILURE_MESSAGE = "System asset pack install could not process the entry.";

export class InstallSystemAssetPackService {
  public constructor(
    private readonly dependencies: InstallSystemAssetPackServiceDependencies,
  ) {}

  public async install(
    input: InstallSystemAssetPackInput,
  ): Promise<InstallSystemAssetPackResult> {
    const mode = input.mode ?? "install";
    const manifest = input.manifest;
    const diagnostics: AssetPackInstallDiagnostic[] = [];
    const issues = [...this.validateBeforePersistence(input)];

    if (hasErrors(issues)) {
      diagnostics.push({
        severity: "error",
        code: "system-pack-validation-failed",
        message: "System asset pack validation failed; no definitions were saved.",
      });
      return resultFor(manifest, "failed", {
        checkedEntryCount: manifest.assets.length,
        issues,
        diagnostics,
      });
    }

    if (mode === "validate-only") {
      diagnostics.push({
        severity: "info",
        code: "system-pack-validated",
        message: "System asset pack validated; no definitions were saved.",
      });
      return resultFor(manifest, "validated", {
        checkedEntryCount: manifest.assets.length,
        issues,
        diagnostics,
      });
    }

    const plan = await this.planInstall(input, diagnostics, issues);
    if (plan.failed) {
      return resultFor(manifest, "failed", {
        checkedEntryCount: manifest.assets.length,
        failedEntryCount: plan.failedEntryCount,
        issues,
        diagnostics,
      });
    }

    const installedDefinitionRefs: AssetReference[] = [];
    const skippedDefinitionRefs: AssetReference[] = [];
    let failedEntryCount = 0;

    const canBatch = this.dependencies.definitionRepository.saveDefinitions &&
      (!this.dependencies.registerAssetDefinition || this.dependencies.registerAssetDefinition.executeMany);
    if (canBatch) {
      for (let offset = 0; offset < plan.actions.length; offset += 250) {
        const batch = plan.actions.slice(offset, offset + 250);
        const writes = batch.filter((action): action is Exclude<PlannedInstallAction, { kind: "skip" }> => action.kind !== "skip");
        let saved = true;
        if (writes.length) {
          try {
            const definitions = writes.map(a => a.definition);
            const expected = writes.map(a => a.expected);
            const registered = this.dependencies.registerAssetDefinition
              ? await this.dependencies.registerAssetDefinition.executeMany!(definitions, expected)
              : { ok: true, value: await this.dependencies.definitionRepository.saveDefinitions!(definitions, expected) };
            saved = registered.ok;
          } catch { saved = false; }
        }
        for (const action of batch) {
          if (action.kind === "skip") { skippedDefinitionRefs.push(action.definitionRef); diagnostics.push(action.diagnostic); }
          else if (!saved) {
            failedEntryCount++;
            diagnostics.push({ severity: "error", code: "definition-save-failed", message: SAFE_FAILURE_MESSAGE,
              entryId: action.entry.entryId, definitionRef: action.definitionRef, metadata: { operation: action.kind } });
          } else {
            installedDefinitionRefs.push(action.definitionRef);
            diagnostics.push({ severity: "info", code: action.kind === "refresh" ? "definition-refreshed" : "definition-installed",
              message: "System-owned definition was installed.", entryId: action.entry.entryId, definitionRef: action.definitionRef });
          }
        }
      }
    } else {
    for (const action of plan.actions) {
      if (action.kind === "skip") {
        skippedDefinitionRefs.push(action.definitionRef);
        diagnostics.push(action.diagnostic);
        continue;
      }

      try {
        const saved = await this.saveDefinition(action.definition);
        if (!saved.ok) {
          failedEntryCount += 1;
          diagnostics.push({
            severity: "error",
            code: "definition-save-rejected",
            message: SAFE_FAILURE_MESSAGE,
            entryId: action.entry.entryId,
            definitionRef: action.definitionRef,
            metadata: { operation: action.kind },
          });
          continue;
        }
      } catch {
        failedEntryCount += 1;
        diagnostics.push({
          severity: "error",
          code: "definition-save-failed",
          message: SAFE_FAILURE_MESSAGE,
          entryId: action.entry.entryId,
          definitionRef: action.definitionRef,
          metadata: { operation: action.kind },
        });
        continue;
      }

      installedDefinitionRefs.push(action.definitionRef);
      diagnostics.push({
        severity: "info",
        code: action.kind === "refresh" ? "definition-refreshed" : "definition-installed",
        message:
          action.kind === "refresh"
            ? "Existing system-owned definition was refreshed by explicit request."
            : "System-owned definition was installed.",
        entryId: action.entry.entryId,
        definitionRef: action.definitionRef,
      });
    }
    }

    if (failedEntryCount > 0) {
      return resultFor(manifest, "failed", {
        checkedEntryCount: manifest.assets.length,
        installedDefinitionRefs,
        skippedDefinitionRefs,
        skippedEntryCount: skippedDefinitionRefs.length,
        failedEntryCount,
        issues,
        diagnostics,
      });
    }

    return resultFor(
      manifest,
      skippedDefinitionRefs.length > 0 ? "installed-with-skips" : "installed",
      {
        checkedEntryCount: manifest.assets.length,
        installedDefinitionRefs,
        skippedDefinitionRefs,
        skippedEntryCount: skippedDefinitionRefs.length,
        issues,
        diagnostics,
      },
    );
  }

  private validateBeforePersistence(input: InstallSystemAssetPackInput): readonly AssetValidationIssue[] {
    const manifest = input.manifest;
    const issues: AssetValidationIssue[] = [];

    if (input.expectedPackId && manifest.packId !== input.expectedPackId) {
      issues.push(issue("error", "identity", "Asset pack ID did not match the expected system pack ID.", ["packId"]));
    }
    if (manifest.sourceKind !== "system") {
      issues.push(issue("error", "provenance", "System asset pack installs require system source kind.", ["sourceKind"]));
    }
    if (manifest.sourceLayer !== "system-default") {
      issues.push(issue("error", "provenance", "System asset pack installs require the system-default source layer.", ["sourceLayer"]));
    }
    if (manifest.trustStatus !== "system-trusted") {
      issues.push(issue("error", "provenance", "System asset pack installs require system-trusted manifests.", ["trustStatus"]));
    }

    issues.push(...validateAssetPackManifest(manifest).issues);

    manifest.assets.forEach((entry, index) => {
      const entryPath = ["assets", String(index)];
      issues.push(...validateAssetPackAssetEntry(entry, entryPath));
      issues.push(
        ...validateAssetDefinition(entry.definition).issues.map((validationIssue) => ({
          ...validationIssue,
          path: [...entryPath, "definition", ...(validationIssue.path ?? [])],
        })),
      );
      issues.push(
        ...runAssetPackQualityGates(entry).issues.map((qualityIssue) => ({
          ...qualityIssue,
          path: [...entryPath, "qualityGates", ...(qualityIssue.path ?? [])],
        })),
      );
    });

    return issues;
  }

  private async planInstall(
    input: InstallSystemAssetPackInput,
    diagnostics: AssetPackInstallDiagnostic[],
    issues: AssetValidationIssue[],
  ): Promise<{ readonly failed: boolean; readonly failedEntryCount: number; readonly actions: readonly PlannedInstallAction[] }> {
    const actions: PlannedInstallAction[] = [];
    let failedEntryCount = 0;

    let storedBatch: readonly (AssetDefinition | undefined)[] | undefined;
    let batchReadFailed = false;
    if (this.dependencies.definitionRepository.getDefinitions) {
      try {
        const values: (AssetDefinition | undefined)[] = [];
        for (let offset = 0; offset < input.manifest.assets.length; offset += 250) {
          const refs = input.manifest.assets.slice(offset, offset + 250).map(e => definitionReference(e.definition));
          const batch = await this.dependencies.definitionRepository.getDefinitions(refs);
          if (types.isProxy(batch) || !Array.isArray(batch) || batch.length !== refs.length) throw new Error(SAFE_FAILURE_MESSAGE);
          for (let n = 0; n < batch.length; n++) {
            const descriptor = Object.getOwnPropertyDescriptor(batch, String(n));
            if (!descriptor || !("value" in descriptor)) throw new Error(SAFE_FAILURE_MESSAGE);
            values.push(descriptor.value);
          }
        }
        storedBatch = values;
      } catch { batchReadFailed = true; }
    }
    for (const [index, entry] of input.manifest.assets.entries()) {
      const definitionRef = definitionReference(entry.definition);
      let existing: AssetDefinition | undefined;
      try {
        if (batchReadFailed) throw new Error(SAFE_FAILURE_MESSAGE);
        const stored = storedBatch ? storedBatch[index] : await this.dependencies.definitionRepository.getDefinition(definitionRef);
        if (stored !== undefined) {
          const captured = captureAssetPackFingerprintInput(stored);
          if (!captured || typeof captured !== "object" || Array.isArray(captured)) throw new Error(SAFE_FAILURE_MESSAGE);
          existing = captured as unknown as AssetDefinition;
          if (existing.definitionId !== definitionRef.id || existing.version !== definitionRef.version) throw new Error(SAFE_FAILURE_MESSAGE);
        }
      } catch {
        failedEntryCount += 1;
        diagnostics.push({
          severity: "error",
          code: "definition-read-failed",
          message: SAFE_FAILURE_MESSAGE,
          entryId: entry.entryId,
          definitionRef,
          metadata: { operation: "read" },
        });
        continue;
      }

      const enrichedDefinition = withSystemPackMetadata(entry.definition, input.manifest, entry, input.now?.() ?? new Date());
      if (!existing) {
        actions.push({ kind: "install", entry, definition: enrichedDefinition, definitionRef });
        continue;
      }

      const existingMetadata = getSystemPackDefinitionMetadata(existing.metadata);
      const matchingDefinition = isMatchingInstalledDefinition(existing, input.manifest, entry, existingMetadata);
      if (matchingDefinition) {
        actions.push({
          kind: "skip",
          entry,
          definitionRef,
          diagnostic: {
            severity: "info",
            code: "definition-already-installed",
            message: "Matching system-owned definition is already installed.",
            entryId: entry.entryId,
            definitionRef,
            metadata: { sourceLayer: entry.sourceLayer },
          },
        });
        continue;
      }

      if (input.allowSystemDefinitionRefresh === true && isRefreshableSystemDefinition(existingMetadata, input.manifest, entry)) {
        actions.push({ kind: "refresh", entry, definition: enrichedDefinition, definitionRef, expected: existing });
        continue;
      }

      failedEntryCount += 1;
      issues.push({
        severity: "error",
        category: "identity",
        message: "Existing definition conflicts with the system pack entry and was not overwritten.",
        assetRef: definitionRef,
        path: ["assets", entry.entryId],
        details: {
          packId: input.manifest.packId,
          packVersion: input.manifest.version,
          entryId: entry.entryId,
          sourceLayer: entry.sourceLayer,
          existingSystemPackDefinition: existingMetadata !== undefined,
        },
      });
      diagnostics.push({
        severity: "error",
        code: "definition-conflict-not-overwritten",
        message:
          "Existing definition was not overwritten. System asset pack install stopped before saving later entries.",
        entryId: entry.entryId,
        definitionRef,
        metadata: {
          existingSystemPackDefinition: existingMetadata !== undefined,
          sourceLayer: entry.sourceLayer,
        },
      });
      return { failed: true, failedEntryCount, actions };
    }

    return { failed: failedEntryCount > 0, failedEntryCount, actions };
  }

  private async saveDefinition(definition: AssetDefinition): Promise<{ readonly ok: boolean; readonly validation?: AssetValidationResult }> {
    if (this.dependencies.registerAssetDefinition) {
      const result = await this.dependencies.registerAssetDefinition.execute(definition);
      return { ok: result.ok, validation: result.validation };
    }

    const validation = validateAssetDefinition(definition);
    if (validation.status !== "valid" && validation.status !== "valid-with-warnings") {
      return { ok: false, validation };
    }
    await this.dependencies.definitionRepository.saveDefinition(definition);
    return { ok: true, validation };
  }
}

function withSystemPackMetadata(
  definition: AssetDefinition,
  manifest: AssetPackManifest,
  entry: AssetPackManifest["assets"][number],
  now: Date,
): AssetDefinition {
  const installedAt = now.toISOString();
  const assetPackInstall: SystemPackDefinitionMetadata = {
    packId: manifest.packId,
    packVersion: manifest.version,
    entryId: entry.entryId,
    fingerprint: entry.fingerprint,
    sourceKind: "system",
    sourceLayer: "system-default",
    trustStatus: "system-trusted",
    managedBy: "asset-kernel",
    installedAt,
  };

  return {
    ...definition,
    metadata: {
      ...(definition.metadata ?? {}),
      sourcePackId: manifest.packId,
      sourcePackVersion: manifest.version,
      sourceLayer: entry.sourceLayer,
      sourcePackEntryId: entry.entryId,
      sourcePackFingerprint: entry.fingerprint,
      assetPackInstall,
    },
    provenance: {
      ...definition.provenance,
      metadata: {
        ...(definition.provenance.metadata ?? {}),
        sourcePackId: manifest.packId,
        sourcePackVersion: manifest.version,
        sourceLayer: entry.sourceLayer,
        sourcePackEntryId: entry.entryId,
      },
    },
  };
}

function definitionReference(definition: AssetDefinition): AssetReference {
  return {
    kind: "asset-definition-version",
    id: String(definition.definitionId) as AssetReference["id"],
    version: definition.version,
  };
}

function getSystemPackDefinitionMetadata(metadata: AssetMetadata | undefined): SystemPackDefinitionMetadata | undefined {
  const marker = metadata?.assetPackInstall;
  if (!isRecord(marker)) return undefined;
  if (
    typeof marker.packId !== "string" ||
    typeof marker.packVersion !== "string" ||
    typeof marker.entryId !== "string" ||
    typeof marker.fingerprint !== "string" ||
    marker.sourceKind !== "system" ||
    marker.sourceLayer !== "system-default" ||
    marker.trustStatus !== "system-trusted" ||
    marker.managedBy !== "asset-kernel" ||
    typeof marker.installedAt !== "string"
  ) {
    return undefined;
  }
  return marker as unknown as SystemPackDefinitionMetadata;
}

function isMatchingInstalledDefinition(
  existing: AssetDefinition,
  manifest: AssetPackManifest,
  entry: AssetPackManifest["assets"][number],
  metadata: SystemPackDefinitionMetadata | undefined,
): boolean {
  if (!(
    metadata?.packId === manifest.packId &&
    metadata.packVersion === manifest.version &&
    metadata.entryId === entry.entryId &&
    metadata.fingerprint === entry.fingerprint &&
    existing.definitionId === entry.definition.definitionId &&
    existing.version === entry.definition.version
  )) return false;
  try {
    // The legacy marker identifies an expected source, never the stored body.
    // Reconstruct only the permitted operational enrichment and compare all content.
    const expected = withSystemPackMetadata(entry.definition, manifest, entry, new Date(metadata.installedAt));
    return isDeepStrictEqual(existing, captureAssetPackFingerprintInput(expected));
  } catch { return false; }
}

function isRefreshableSystemDefinition(
  metadata: SystemPackDefinitionMetadata | undefined,
  manifest: AssetPackManifest,
  entry: AssetPackManifest["assets"][number],
): boolean {
  return metadata?.packId === manifest.packId && metadata.sourceLayer === entry.sourceLayer;
}

function issue(
  severity: AssetValidationIssue["severity"],
  category: AssetValidationIssue["category"],
  message: string,
  path: readonly string[],
): AssetValidationIssue {
  return { severity, category, message, path };
}

function hasErrors(issues: readonly AssetValidationIssue[]): boolean {
  return issues.some((validationIssue) => validationIssue.severity === "error");
}

function resultFor(
  manifest: AssetPackManifest,
  status: InstallSystemAssetPackStatus,
  values: {
    readonly checkedEntryCount: number;
    readonly installedDefinitionRefs?: readonly AssetReference[];
    readonly skippedDefinitionRefs?: readonly AssetReference[];
    readonly skippedEntryCount?: number;
    readonly failedEntryCount?: number;
    readonly issues?: readonly AssetValidationIssue[];
    readonly diagnostics?: readonly AssetPackInstallDiagnostic[];
  },
): InstallSystemAssetPackResult {
  const installedDefinitionRefs = values.installedDefinitionRefs ?? [];
  const skippedDefinitionRefs = values.skippedDefinitionRefs ?? [];
  return {
    status,
    packId: manifest.packId,
    packVersion: manifest.version,
    checkedEntryCount: values.checkedEntryCount,
    installedEntryCount: installedDefinitionRefs.length,
    skippedEntryCount: values.skippedEntryCount ?? skippedDefinitionRefs.length,
    failedEntryCount: values.failedEntryCount ?? 0,
    installedDefinitionRefs,
    skippedDefinitionRefs,
    issues: values.issues ?? [],
    diagnostics: values.diagnostics ?? [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
