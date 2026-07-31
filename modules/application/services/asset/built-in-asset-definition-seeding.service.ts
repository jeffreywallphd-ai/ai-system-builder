import type { AssetDefinition, AssetMetadata, AssetReference, AssetValidationIssue } from "../../../contracts/asset";
import { isAssetId, isAssetVersion } from "../../../contracts/asset";
import type { AssetDefinitionRepositoryPort } from "../../ports/asset";
import { validateAssetDefinition, type AssetValidationResult } from "./validate-asset-definition.service";
import { createBuiltInAssetDefinitionFingerprint } from "./built-ins/built-in-asset-definition-fingerprint";

export interface BuiltInAssetDefinitionSeed {
  readonly seedId: string;
  readonly seedVersion: string;
  readonly definition: AssetDefinition;
  readonly fingerprint?: string;
  readonly source?: "system" | "built-in";
}

export type BuiltInAssetDefinitionSeedStatus =
  | "created"
  | "already-current"
  | "skipped-user-modified"
  | "skipped-seed-version-mismatch"
  | "invalid"
  | "failed";

export interface BuiltInAssetDefinitionSeedDiagnostic {
  readonly seedId: string;
  readonly definitionId?: string;
  readonly version?: string;
  readonly status: BuiltInAssetDefinitionSeedStatus;
  readonly message: string;
  readonly validationIssues?: readonly AssetValidationIssue[];
  readonly metadata?: Record<string, unknown>;
}

export interface BuiltInAssetDefinitionSeedingResult {
  readonly createdCount: number;
  readonly unchangedCount: number;
  readonly skippedCount: number;
  readonly invalidCount: number;
  readonly failedCount: number;
  readonly diagnostics: readonly BuiltInAssetDefinitionSeedDiagnostic[];
}

export interface BuiltInAssetDefinitionSeedingOptions {
  readonly failOnInvalid?: boolean;
  readonly failOnFailed?: boolean;
}

export interface BuiltInAssetDefinitionSeedingServiceDependencies {
  readonly definitionRepository: AssetDefinitionRepositoryPort;
  readonly registerAssetDefinition?: {
    execute(definition: AssetDefinition): Promise<{ readonly ok: boolean; readonly validation?: AssetValidationResult }>;
  };
  readonly now?: () => string;
}

export class BuiltInAssetDefinitionSeedingError extends Error {
  public readonly result: BuiltInAssetDefinitionSeedingResult;

  public constructor(message: string, result: BuiltInAssetDefinitionSeedingResult) {
    super(message);
    this.name = "BuiltInAssetDefinitionSeedingError";
    this.result = result;
  }
}

type BuiltInSeedMetadata = {
  readonly seedId: string;
  readonly seedVersion: string;
  readonly fingerprint: string;
  readonly managedBy: "asset-kernel";
  readonly lastSeededAt: string;
};

const SAFE_FAILURE_MESSAGE = "Built-in asset definition seed could not be processed.";
const SEMVER_LIKE_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export class BuiltInAssetDefinitionSeedingService {
  private readonly now: () => string;

  public constructor(private readonly dependencies: BuiltInAssetDefinitionSeedingServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  public async seedDefinitions(
    seeds: readonly BuiltInAssetDefinitionSeed[],
    options: BuiltInAssetDefinitionSeedingOptions = {},
  ): Promise<BuiltInAssetDefinitionSeedingResult> {
    const diagnostics: BuiltInAssetDefinitionSeedDiagnostic[] = [];

    for (const seed of seeds) {
      diagnostics.push(await this.processSeed(seed));
    }

    const result = summarizeDiagnostics(diagnostics);
    if (options.failOnInvalid && result.invalidCount > 0) {
      throw new BuiltInAssetDefinitionSeedingError("Built-in asset definition seeding found invalid seeds.", result);
    }
    if (options.failOnFailed && result.failedCount > 0) {
      throw new BuiltInAssetDefinitionSeedingError("Built-in asset definition seeding failed for one or more seeds.", result);
    }

    return result;
  }

  private async processSeed(seed: BuiltInAssetDefinitionSeed): Promise<BuiltInAssetDefinitionSeedDiagnostic> {
    const definitionId = String(seed.definition.definitionId ?? "");
    const version = String(seed.definition.version ?? "");
    const seedValidationIssues = validateSeedDescriptor(seed);
    const definitionValidation = validateAssetDefinition(seed.definition);
    const validationIssues = [...seedValidationIssues, ...definitionValidation.issues];
    const hasValidationErrors = validationIssues.some((issue) => issue.severity === "error");

    if (hasValidationErrors) {
      return {
        seedId: seed.seedId,
        definitionId,
        version,
        status: "invalid",
        message: "Built-in asset definition seed is invalid and was not saved.",
        validationIssues,
      };
    }

    const fingerprint = seed.fingerprint ?? createBuiltInAssetDefinitionFingerprint(seed.definition);
    const reference: AssetReference = { kind: "asset-definition-version", id: definitionId as AssetReference["id"], version };

    let existing: AssetDefinition | undefined;
    try {
      existing = await this.dependencies.definitionRepository.getDefinition(reference);
    } catch {
      return failedDiagnostic(seed, "read");
    }

    if (existing) {
      const existingMarker = getBuiltInSeedMetadata(existing.metadata);
      if (existingMarker?.seedId === seed.seedId && existingMarker.fingerprint === fingerprint) {
        if (existingMarker.seedVersion === seed.seedVersion) {
          return {
            seedId: seed.seedId,
            definitionId,
            version,
            status: "already-current",
            message: "Built-in asset definition seed is already current.",
            metadata: { managedBy: existingMarker.managedBy },
          };
        }

        return {
          seedId: seed.seedId,
          definitionId,
          version,
          status: "skipped-seed-version-mismatch",
          message: "Existing asset definition was not overwritten because its built-in seed version does not match.",
          metadata: { existingBuiltInSeed: true, seedVersionMismatch: true },
        };
      }

      return {
        seedId: seed.seedId,
        definitionId,
        version,
        status: "skipped-user-modified",
        message: "Existing asset definition was not overwritten because it is not the same built-in seed fingerprint.",
        metadata: { existingBuiltInSeed: existingMarker !== undefined },
      };
    }

    const enrichedDefinition = withBuiltInSeedMetadata(seed.definition, {
      seedId: seed.seedId,
      seedVersion: seed.seedVersion,
      fingerprint,
      managedBy: "asset-kernel",
      lastSeededAt: this.now(),
    });

    try {
      const registered = this.dependencies.registerAssetDefinition
        ? await this.dependencies.registerAssetDefinition.execute(enrichedDefinition)
        : await this.validateAndSaveDefinition(enrichedDefinition);
      if (!registered.ok) {
        return {
          seedId: seed.seedId,
          definitionId,
          version,
          status: "invalid",
          message: "Built-in asset definition seed is invalid and was not saved.",
          validationIssues: registered.validation?.issues ?? validationIssues,
        };
      }
    } catch {
      return failedDiagnostic(seed, "save");
    }

    return {
      seedId: seed.seedId,
      definitionId,
      version,
      status: "created",
      message: "Built-in asset definition seed was created.",
      metadata: { managedBy: "asset-kernel" },
    };
  }

  private async validateAndSaveDefinition(definition: AssetDefinition): Promise<{ readonly ok: boolean; readonly validation: AssetValidationResult }> {
    const validation = validateAssetDefinition(definition);
    if (validation.status !== "valid" && validation.status !== "valid-with-warnings") {
      return { ok: false, validation };
    }
    await this.dependencies.definitionRepository.saveDefinition(definition);
    return { ok: true, validation };
  }
}

function summarizeDiagnostics(diagnostics: readonly BuiltInAssetDefinitionSeedDiagnostic[]): BuiltInAssetDefinitionSeedingResult {
  return {
    createdCount: diagnostics.filter((diagnostic) => diagnostic.status === "created").length,
    unchangedCount: diagnostics.filter((diagnostic) => diagnostic.status === "already-current").length,
    skippedCount: diagnostics.filter((diagnostic) =>
      diagnostic.status === "skipped-user-modified" || diagnostic.status === "skipped-seed-version-mismatch",
    ).length,
    invalidCount: diagnostics.filter((diagnostic) => diagnostic.status === "invalid").length,
    failedCount: diagnostics.filter((diagnostic) => diagnostic.status === "failed").length,
    diagnostics,
  };
}

function validateSeedDescriptor(seed: BuiltInAssetDefinitionSeed): readonly AssetValidationIssue[] {
  const issues: AssetValidationIssue[] = [];
  const seedRef: AssetReference = { kind: "asset-definition", id: String(seed.definition.definitionId ?? "") as AssetReference["id"] };

  if (!isStableNamespacedId(seed.seedId)) {
    issues.push(seedIssue("seedId", "Built-in asset definition seed id must be a stable namespaced asset id.", seedRef));
  }
  if (!isSemverLike(seed.seedVersion)) {
    issues.push(seedIssue("seedVersion", "Built-in asset definition seed version must be semver-like.", seedRef));
  }
  if (!isStableNamespacedId(String(seed.definition.definitionId ?? ""))) {
    issues.push(seedIssue("definitionId", "Built-in asset definition id must be stable and namespaced.", seedRef));
  }
  if (!isAssetVersion(String(seed.definition.version ?? ""))) {
    issues.push(seedIssue("version", "Built-in asset definition version must be explicit.", seedRef));
  }

  return issues;
}

function seedIssue(path: string, message: string, assetRef: AssetReference): AssetValidationIssue {
  return { severity: "error", category: "identity", message, assetRef, path: [path] };
}

function isStableNamespacedId(value: string): boolean {
  return isAssetId(value) && value.includes(".");
}

function isSemverLike(value: string): boolean {
  return SEMVER_LIKE_PATTERN.test(value.trim());
}

function withBuiltInSeedMetadata(definition: AssetDefinition, builtInSeed: BuiltInSeedMetadata): AssetDefinition {
  return {
    ...definition,
    metadata: {
      ...(definition.metadata ?? {}),
      builtInSeed,
    },
  };
}

function getBuiltInSeedMetadata(metadata: AssetMetadata | undefined): BuiltInSeedMetadata | undefined {
  const marker = metadata?.builtInSeed;
  if (!isRecord(marker)) return undefined;
  if (
    typeof marker.seedId !== "string" ||
    typeof marker.seedVersion !== "string" ||
    typeof marker.fingerprint !== "string" ||
    marker.managedBy !== "asset-kernel" ||
    typeof marker.lastSeededAt !== "string"
  ) {
    return undefined;
  }
  return marker as BuiltInSeedMetadata;
}

function failedDiagnostic(seed: BuiltInAssetDefinitionSeed, operation: "read" | "save"): BuiltInAssetDefinitionSeedDiagnostic {
  return {
    seedId: seed.seedId,
    definitionId: String(seed.definition.definitionId ?? ""),
    version: String(seed.definition.version ?? ""),
    status: "failed",
    message: SAFE_FAILURE_MESSAGE,
    metadata: { operation },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
