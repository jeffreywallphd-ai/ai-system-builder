import type { AssetMetadata } from "../asset";

export const ASSET_AUTHORING_DIAGNOSTIC_CODES = [
  "asset-authoring-workspace-required",
  "asset-authoring-workspace-invalid",
  "asset-authoring-target-required",
  "asset-authoring-target-unsupported",
  "asset-authoring-editable-field-unsupported",
  "asset-authoring-unsafe-value",
  "asset-authoring-system-source-immutable",
  "asset-authoring-linked-source-mutation-not-allowed",
  "asset-authoring-conflict-detected",
  "asset-authoring-base-version-mismatch",
  "asset-authoring-derived-base-invalid",
  "asset-authoring-source-overlay-invalid",
  "asset-authoring-source-overlay-secret-detected",
  "asset-authoring-protected-field-immutable",
  "asset-authoring-review-stale",
  "asset-authoring-publication-invalid",
] as const;
export type AssetAuthoringDiagnosticCode =
  (typeof ASSET_AUTHORING_DIAGNOSTIC_CODES)[number];
export type AssetAuthoringDiagnosticSeverity = "info" | "warning" | "error";
export interface AssetAuthoringDiagnostic {
  readonly severity: AssetAuthoringDiagnosticSeverity;
  readonly code: AssetAuthoringDiagnosticCode;
  readonly message: string;
  readonly safeDetails?: AssetMetadata;
}
