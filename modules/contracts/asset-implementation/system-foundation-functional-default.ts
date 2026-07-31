import type { AssetConfigurationValues, AssetMetadata } from "../asset";
import type {
  AssetImplementationDeploymentProfile,
  AssetImplementationFacetKind,
  AssetImplementationRuntimeKind,
} from "./asset-implementation-enums";

export const SYSTEM_FOUNDATION_PREVIEW_KINDS = [
  "layout",
  "form",
  "data",
  "state",
  "conversation",
  "workflow",
  "policy",
  "semantic",
] as const;

export type SystemFoundationPreviewKind =
  (typeof SYSTEM_FOUNDATION_PREVIEW_KINDS)[number];

/**
 * Closed, data-only mapping from an exact system.foundation definition to a
 * platform-owned implementation entry. It intentionally cannot carry source,
 * functions, component references, routes, SQL, credentials, or package bytes.
 */
export interface SystemFoundationFunctionalDefault {
  readonly definitionId: string;
  readonly definitionVersion: string;
  readonly displayName: string;
  readonly entryKey: string;
  readonly facetKind: AssetImplementationFacetKind;
  readonly runtimeKind: AssetImplementationRuntimeKind;
  readonly deploymentProfiles: readonly AssetImplementationDeploymentProfile[];
  readonly previewKind: SystemFoundationPreviewKind;
  readonly previewConfiguration: AssetConfigurationValues;
  readonly previewFixture: AssetMetadata;
  readonly failClosed: boolean;
  readonly requiredCapabilities: readonly string[];
}

