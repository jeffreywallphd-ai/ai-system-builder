export const ASSET_IMPLEMENTATION_FACET_KINDS = [
  "ui",
  "logic",
  "workflow",
  "data",
  "migration",
  "policy",
  "test",
  "declarative",
] as const;
export type AssetImplementationFacetKind =
  (typeof ASSET_IMPLEMENTATION_FACET_KINDS)[number];

export const ASSET_IMPLEMENTATION_RUNTIME_KINDS = [
  "trusted-built-in",
  "declarative-engine",
  "sandboxed-browser",
  "wasi-component",
  "isolated-worker",
] as const;
export type AssetImplementationRuntimeKind =
  (typeof ASSET_IMPLEMENTATION_RUNTIME_KINDS)[number];

export const ASSET_IMPLEMENTATION_DRAFT_STATUSES = [
  "draft",
  "source-snapshotted",
  "building",
  "published",
  "archived",
] as const;
export type AssetImplementationDraftStatus =
  (typeof ASSET_IMPLEMENTATION_DRAFT_STATUSES)[number];

export const ASSET_IMPLEMENTATION_BUILD_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type AssetImplementationBuildStatus =
  (typeof ASSET_IMPLEMENTATION_BUILD_STATUSES)[number];

export const ASSET_IMPLEMENTATION_RELEASE_STATUSES = [
  "published",
  "deprecated",
] as const;
export type AssetImplementationReleaseStatus =
  (typeof ASSET_IMPLEMENTATION_RELEASE_STATUSES)[number];

export const ASSET_IMPLEMENTATION_BINDING_STATUSES = [
  "active",
  "disabled",
] as const;
export type AssetImplementationBindingStatus =
  (typeof ASSET_IMPLEMENTATION_BINDING_STATUSES)[number];

export const ASSET_IMPLEMENTATION_TRUST_LEVELS = [
  "system-trusted",
  "organization-approved",
  "workspace-approved",
] as const;
export type AssetImplementationTrustLevel =
  (typeof ASSET_IMPLEMENTATION_TRUST_LEVELS)[number];

export const ASSET_IMPLEMENTATION_DEPLOYMENT_PROFILES = [
  "local-desktop",
  "campus-server",
  "cloud-server",
  "thin-client",
] as const;
export type AssetImplementationDeploymentProfile =
  (typeof ASSET_IMPLEMENTATION_DEPLOYMENT_PROFILES)[number];

export const ASSET_IMPLEMENTATION_READINESS_STATUSES = [
  "ready",
  "unimplemented",
  "incompatible",
  "setup-required",
  "blocked",
  "revoked",
] as const;
export type AssetImplementationReadinessStatus =
  (typeof ASSET_IMPLEMENTATION_READINESS_STATUSES)[number];

function normalizeEnum<T extends string>(
  value: string,
  values: readonly T[],
  label: string,
): T {
  const normalized = value.trim().toLowerCase() as T;
  if (!values.includes(normalized))
    throw new Error(`${label} is unsupported: ${value}.`);
  return normalized;
}

export const normalizeAssetImplementationFacetKind = (value: string) =>
  normalizeEnum(
    value,
    ASSET_IMPLEMENTATION_FACET_KINDS,
    "Asset implementation facet kind",
  );
export const normalizeAssetImplementationRuntimeKind = (value: string) =>
  normalizeEnum(
    value,
    ASSET_IMPLEMENTATION_RUNTIME_KINDS,
    "Asset implementation runtime kind",
  );
export const normalizeAssetImplementationDraftStatus = (value: string) =>
  normalizeEnum(
    value,
    ASSET_IMPLEMENTATION_DRAFT_STATUSES,
    "Asset implementation draft status",
  );
export const normalizeAssetImplementationBuildStatus = (value: string) =>
  normalizeEnum(
    value,
    ASSET_IMPLEMENTATION_BUILD_STATUSES,
    "Asset implementation build status",
  );
export const normalizeAssetImplementationReleaseStatus = (value: string) =>
  normalizeEnum(
    value,
    ASSET_IMPLEMENTATION_RELEASE_STATUSES,
    "Asset implementation release status",
  );
export const normalizeAssetImplementationBindingStatus = (value: string) =>
  normalizeEnum(
    value,
    ASSET_IMPLEMENTATION_BINDING_STATUSES,
    "Asset implementation binding status",
  );
export const normalizeAssetImplementationTrustLevel = (value: string) =>
  normalizeEnum(
    value,
    ASSET_IMPLEMENTATION_TRUST_LEVELS,
    "Asset implementation trust level",
  );
export const normalizeAssetImplementationDeploymentProfile = (value: string) =>
  normalizeEnum(
    value,
    ASSET_IMPLEMENTATION_DEPLOYMENT_PROFILES,
    "Asset implementation deployment profile",
  );
