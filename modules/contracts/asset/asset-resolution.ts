import type { AssetDefinition } from "./asset-definition";
import type { AssetMetadata } from "./asset-metadata";
import type { AssetPackOverrideScope } from "./asset-pack-override-rule";
import type { AssetReference } from "./asset-reference";
import type { AssetSourceLayer } from "./asset-source-layer";

export const ASSET_RESOLUTION_MODES = [
  "exact",
  "semantic",
  "compatible",
  "latest-active",
] as const;

export type AssetResolutionMode = (typeof ASSET_RESOLUTION_MODES)[number];

export const ASSET_RESOLUTION_DIAGNOSTIC_SEVERITIES = [
  "info",
  "warning",
  "error",
] as const;

export type AssetResolutionDiagnosticSeverity =
  (typeof ASSET_RESOLUTION_DIAGNOSTIC_SEVERITIES)[number];

export interface AssetResolutionRequest {
  readonly requestedRef: AssetReference;
  readonly mode: AssetResolutionMode;
  readonly scope?: AssetPackOverrideScope;
  readonly sourceLayerPreference?: readonly AssetSourceLayer[];
  /**
   * Future exact asset-definition-version resolution should set this false by
   * default so exact references can bypass non-destructive override rules.
   * Semantic, unversioned, or default references may opt into overrides later.
   */
  readonly allowOverrides?: boolean;
  readonly includeTrace?: boolean;
  readonly metadata?: AssetMetadata;
}

export interface AssetResolutionTraceStep {
  readonly stepId: string;
  readonly message: string;
  readonly inputRef?: AssetReference;
  readonly outputRef?: AssetReference;
  readonly sourceLayer?: AssetSourceLayer;
  readonly appliedOverrideRuleId?: string;
  readonly metadata?: AssetMetadata;
}

export interface AssetResolutionDiagnostic {
  readonly severity: AssetResolutionDiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly ref?: AssetReference;
  readonly metadata?: AssetMetadata;
}

export interface AssetResolutionConflict {
  readonly conflictId: string;
  readonly targetRef: AssetReference;
  readonly candidateRefs: readonly AssetReference[];
  readonly overrideRuleIds?: readonly string[];
  readonly message?: string;
  readonly metadata?: AssetMetadata;
}

export interface AssetResolutionResult {
  readonly requestedRef: AssetReference;
  readonly resolvedRef?: AssetReference;
  readonly resolvedDefinition?: AssetDefinition;
  readonly appliedOverrideRuleIds: readonly string[];
  readonly trace: readonly AssetResolutionTraceStep[];
  readonly diagnostics: readonly AssetResolutionDiagnostic[];
  readonly conflicts: readonly AssetResolutionConflict[];
}

export function isAssetResolutionMode(
  value: string,
): value is AssetResolutionMode {
  return ASSET_RESOLUTION_MODES.includes(value as AssetResolutionMode);
}

export function normalizeAssetResolutionMode(value: string): AssetResolutionMode {
  const normalized = value.trim().toLowerCase();

  if (!isAssetResolutionMode(normalized)) {
    throw new Error(
      `Asset resolution mode must be one of ${ASSET_RESOLUTION_MODES.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}

export function isAssetResolutionDiagnosticSeverity(
  value: string,
): value is AssetResolutionDiagnosticSeverity {
  return ASSET_RESOLUTION_DIAGNOSTIC_SEVERITIES.includes(
    value as AssetResolutionDiagnosticSeverity,
  );
}

export function normalizeAssetResolutionDiagnosticSeverity(
  value: string,
): AssetResolutionDiagnosticSeverity {
  const normalized = value.trim().toLowerCase();

  if (!isAssetResolutionDiagnosticSeverity(normalized)) {
    throw new Error(
      `Asset resolution diagnostic severity must be one of ${ASSET_RESOLUTION_DIAGNOSTIC_SEVERITIES.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
