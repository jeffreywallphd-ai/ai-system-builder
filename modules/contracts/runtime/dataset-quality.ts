export const DATASET_QUALITY_PRESETS = ["recommended", "strict"] as const;
export type DatasetQualityPreset = (typeof DATASET_QUALITY_PRESETS)[number];

export const DATASET_QUALITY_STATUSES = [
  "ready",
  "needs-attention",
  "blocked",
] as const;
export type DatasetQualityStatus = (typeof DATASET_QUALITY_STATUSES)[number];

export const DATASET_QUALITY_REASON_CODES = [
  "mapping-required-fields-missing",
  "schema-invalid",
  "exact-duplicate",
  "fuzzy-duplicate",
  "text-too-short",
  "text-too-long",
  "language-not-allowed",
  "language-uncertain",
  "sensitive-personal-data",
  "secret-like-content",
  "unsafe-content",
  "benchmark-excluded",
  "source-not-allowed",
  "license-metadata-missing",
  "consent-metadata-missing",
  "source-row-limit",
] as const;
export type DatasetQualityReasonCode =
  (typeof DATASET_QUALITY_REASON_CODES)[number];

export interface DatasetQualityRequestedPolicy {
  preset: DatasetQualityPreset;
  allowedLanguages?: string[];
  requireLicenseMetadata?: boolean;
  requireConsentMetadata?: boolean;
  excludedBenchmarkIds?: string[];
  maxRowsPerSource?: number;
}

export interface DatasetQualityRequestedConfig {
  policy: DatasetQualityRequestedPolicy;
  reviewRequired?: boolean;
}

export interface DatasetQualityMandatoryChecks {
  schema: true;
  exactDuplicates: true;
  fuzzyDuplicates: true;
  sensitivePersonalData: true;
  secretLikeContent: true;
  splitLeakage: true;
}

export interface DatasetQualityEffectivePolicy {
  policyId: string;
  revision: string;
  scope: "workspace" | "organization";
  preset: DatasetQualityPreset;
  allowedLanguages: string[];
  requireLicenseMetadata: boolean;
  requireConsentMetadata: boolean;
  excludedBenchmarkIds: string[];
  maxRowsPerSource: number;
  minimumTextCharacters: number;
  maximumTextCharacters: number;
  fuzzyDuplicateSimilarity: number;
  maxFuzzyCandidatesPerRow: number;
  maxReportSamplesPerReason: number;
  mandatoryChecks: DatasetQualityMandatoryChecks;
}

export interface DatasetQualityRuntimeConfig {
  requestedPolicy: DatasetQualityRequestedPolicy;
  effectivePolicy: DatasetQualityEffectivePolicy;
  reviewRequired: boolean;
}

export interface DatasetQualityFieldProfile {
  field: string;
  valueType:
    | "string"
    | "number"
    | "boolean"
    | "object"
    | "array"
    | "mixed";
  presentCount: number;
  missingCount: number;
  distinctCount: number;
}

export interface DatasetQualityMappingProfile {
  taskType: string;
  status: "complete" | "incomplete";
  mappedFields: string[];
  missingRequiredFields: string[];
}

export interface DatasetQualityDistributionEntry {
  label: string;
  count: number;
}

export interface DatasetQualitySanitizedSample {
  sourceArtifactId: string;
  sourceRowIndex: number;
  reasonCodes: DatasetQualityReasonCode[];
  fieldNames: string[];
  summary: string;
}

export interface DatasetQualityReport {
  schemaVersion: "1";
  status: DatasetQualityStatus;
  reportFingerprint: string;
  policy: DatasetQualityEffectivePolicy;
  mapping: DatasetQualityMappingProfile;
  fields: DatasetQualityFieldProfile[];
  distributions: {
    sources: DatasetQualityDistributionEntry[];
    classes?: DatasetQualityDistributionEntry[];
    languages?: DatasetQualityDistributionEntry[];
  };
  counts: {
    inputRows: number;
    acceptedRows: number;
    quarantinedRows: number;
  };
  reasonCounts: Partial<Record<DatasetQualityReasonCode, number>>;
  samples: DatasetQualitySanitizedSample[];
  reviewRequired: boolean;
  approvalAllowed: boolean;
}

export type DatasetQualityReviewState =
  | "not-required"
  | "review-required"
  | "approved"
  | "stopped";

export interface DatasetQualityApprovalRequest {
  requestId: string;
  reportFingerprint: string;
}

export interface DatasetQualityQuarantineRecord {
  sourceArtifactId: string;
  sourceRowIndex: number;
  reasonCodes: DatasetQualityReasonCode[];
  row: Record<string, unknown>;
}

export interface DatasetQualityPolicyResolutionRequest {
  workspaceId: string;
  organizationId?: string;
  requestedPolicy: DatasetQualityRequestedPolicy;
}
