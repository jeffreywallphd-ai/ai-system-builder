import type { AssetMetadata } from "./asset-metadata";

export const ASSET_MUTATION_DIAGNOSTIC_SEVERITIES = [
  "info",
  "warning",
  "error",
] as const;

export type AssetMutationDiagnosticSeverity =
  (typeof ASSET_MUTATION_DIAGNOSTIC_SEVERITIES)[number];

export interface AssetMutationDiagnostic {
  readonly severity: AssetMutationDiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly safeDetails?: AssetMetadata;
}
