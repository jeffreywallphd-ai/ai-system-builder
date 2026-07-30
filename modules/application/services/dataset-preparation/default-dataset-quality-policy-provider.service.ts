import type {
  DatasetQualityEffectivePolicy,
  DatasetQualityPolicyResolutionRequest,
  DatasetQualityRequestedPolicy,
} from "../../../contracts/runtime";
import type { DatasetQualityPolicyProviderPort } from "../../ports/runtime";

const LANGUAGE_TAG_PATTERN = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;
const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const MAX_LANGUAGE_COUNT = 16;
const MAX_EXCLUDED_BENCHMARK_COUNT = 64;

export interface DefaultDatasetQualityPolicyOptions {
  policyId?: string;
  revision?: string;
  allowedLanguages?: readonly string[];
  requireLicenseMetadata?: boolean;
  requireConsentMetadata?: boolean;
  includeSourceAttribution?: boolean;
  excludedBenchmarkIds?: readonly string[];
  maxRowsPerSource?: number;
}

export function createDefaultDatasetQualityPolicyProvider(
  options: DefaultDatasetQualityPolicyOptions = {},
): DatasetQualityPolicyProviderPort {
  const policyId = validateSafeIdentifier(
    options.policyId ?? "baseline-dataset-quality",
    "Quality policy id",
  );
  const revision = validateSafeIdentifier(
    options.revision ?? "1",
    "Quality policy revision",
  );
  const allowedLanguages = validateLanguages(options.allowedLanguages ?? ["en"]);
  const excludedBenchmarkIds = validateIdentifiers(
    options.excludedBenchmarkIds ?? [],
    "Excluded benchmark id",
    MAX_EXCLUDED_BENCHMARK_COUNT,
  );
  const hostMaxRowsPerSource = validateIntegerInRange(
    options.maxRowsPerSource ?? 100_000,
    1,
    1_000_000,
    "Maximum rows per source",
  );

  return {
    async resolveDatasetQualityPolicy(
      request: DatasetQualityPolicyResolutionRequest,
    ): Promise<DatasetQualityEffectivePolicy> {
      if (
        typeof request.workspaceId !== "string" ||
        request.workspaceId.length === 0
      ) {
        throw new Error("A workspace is required to resolve data quality policy.");
      }
      const requested = validateRequestedPolicy(request.requestedPolicy);
      const requestedLanguages =
        requested.allowedLanguages === undefined
          ? [...allowedLanguages]
          : validateLanguages(requested.allowedLanguages);
      const disallowedLanguage = requestedLanguages.find(
        (language) => !allowedLanguages.includes(language),
      );
      if (disallowedLanguage) {
        throw new Error(
          "One or more requested languages are not allowed by the data quality policy.",
        );
      }

      const requestedExcludedBenchmarks = validateIdentifiers(
        requested.excludedBenchmarkIds ?? [],
        "Excluded benchmark id",
        MAX_EXCLUDED_BENCHMARK_COUNT,
      );
      const effectiveExcludedBenchmarks = [
        ...new Set([...excludedBenchmarkIds, ...requestedExcludedBenchmarks]),
      ].sort();
      const requestedMaxRows =
        requested.maxRowsPerSource === undefined
          ? hostMaxRowsPerSource
          : validateIntegerInRange(
              requested.maxRowsPerSource,
              1,
              1_000_000,
              "Maximum rows per source",
            );

      return {
        policyId,
        revision,
        scope: request.organizationId ? "organization" : "workspace",
        preset: requested.preset,
        allowedLanguages: [...requestedLanguages].sort(),
        requireLicenseMetadata:
          options.requireLicenseMetadata === true ||
          requested.requireLicenseMetadata === true,
        requireConsentMetadata:
          options.requireConsentMetadata === true ||
          requested.requireConsentMetadata === true,
        includeSourceAttribution:
          options.includeSourceAttribution === true ||
          requested.includeSourceAttribution === true,
        excludedBenchmarkIds: effectiveExcludedBenchmarks,
        maxRowsPerSource: Math.min(hostMaxRowsPerSource, requestedMaxRows),
        minimumTextCharacters: requested.preset === "strict" ? 20 : 8,
        maximumTextCharacters: requested.preset === "strict" ? 50_000 : 100_000,
        fuzzyDuplicateSimilarity: requested.preset === "strict" ? 0.88 : 0.92,
        maxFuzzyCandidatesPerRow: requested.preset === "strict" ? 96 : 64,
        maxReportSamplesPerReason: 10,
        mandatoryChecks: {
          sourceAssociation: true,
          schema: true,
          exactDuplicates: true,
          fuzzyDuplicates: true,
          sensitivePersonalData: true,
          secretLikeContent: true,
          splitLeakage: true,
        },
      };
    },
  };
}

function validateRequestedPolicy(
  value: DatasetQualityRequestedPolicy,
): DatasetQualityRequestedPolicy {
  if (!value || !["recommended", "strict"].includes(value.preset)) {
    throw new Error("Choose a supported data quality level.");
  }
  return value;
}

function validateLanguages(values: readonly string[]): string[] {
  if (values.length === 0 || values.length > MAX_LANGUAGE_COUNT) {
    throw new Error("Choose between 1 and 16 allowed languages.");
  }
  const normalized = values.map((value) => value.trim());
  if (
    normalized.some((value) => !LANGUAGE_TAG_PATTERN.test(value)) ||
    new Set(normalized).size !== normalized.length
  ) {
    throw new Error("Allowed languages must use unique language tags.");
  }
  return normalized;
}

function validateIdentifiers(
  values: readonly string[],
  label: string,
  maximumCount: number,
): string[] {
  if (values.length > maximumCount) {
    throw new Error(`${label} count exceeds the policy limit.`);
  }
  const normalized = values.map((value) => value.trim());
  if (
    normalized.some((value) => !SAFE_IDENTIFIER_PATTERN.test(value)) ||
    new Set(normalized).size !== normalized.length
  ) {
    throw new Error(`${label} values must be unique safe identifiers.`);
  }
  return normalized;
}

function validateSafeIdentifier(value: string, label: string): string {
  if (!SAFE_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${label} must be a safe identifier.`);
  }
  return value;
}

function validateIntegerInRange(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}
