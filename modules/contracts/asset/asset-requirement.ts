import type { RuntimeCapabilityId } from "../runtime";
import type { AssetMetadata } from "./asset-metadata";
import type { AssetReference } from "./asset-reference";

export const ASSET_REQUIREMENT_KINDS = [
  "runtime-capability",
  "host",
  "permission",
  "network-access",
  "filesystem-access",
  "secret-access",
  "user-approval",
  "thin-client-safety",
  "automation-safety",
  "resource",
  "artifact",
  "external-provider",
  "custom",
] as const;

export type AssetRequirementKind = (typeof ASSET_REQUIREMENT_KINDS)[number];

export const ASSET_REQUIREMENT_HOST_KINDS = [
  "desktop",
  "server",
  "thin-client",
  "desktop-or-server",
  "server-backed-thin-client",
] as const;

export type AssetRequirementHostKind =
  (typeof ASSET_REQUIREMENT_HOST_KINDS)[number];

export const ASSET_REQUIREMENT_PERMISSION_KINDS = [
  "filesystem-read",
  "filesystem-write",
  "network",
  "secret-read",
  "runtime-execution",
  "external-provider-access",
  "artifact-read",
  "artifact-write",
  "resource-read",
  "resource-write",
] as const;

export type AssetRequirementPermissionKind =
  (typeof ASSET_REQUIREMENT_PERMISSION_KINDS)[number];

export const ASSET_REQUIREMENT_SAFETY_STATUSES = [
  "safe",
  "unsafe",
  "requires-review",
  "unknown",
] as const;

export type AssetRequirementSafetyStatus =
  (typeof ASSET_REQUIREMENT_SAFETY_STATUSES)[number];

export interface AssetRequirement {
  readonly requirementId?: string;
  readonly requirementKind: AssetRequirementKind;
  readonly required: boolean;
  readonly runtimeCapabilityId?: RuntimeCapabilityId;
  readonly hostKind?: AssetRequirementHostKind;
  readonly permissionKind?: AssetRequirementPermissionKind;
  readonly safetyStatus?: AssetRequirementSafetyStatus;
  readonly ref?: AssetReference;
  readonly summary?: string;
  readonly details?: AssetMetadata;
  readonly metadata?: AssetMetadata;
}

export function isAssetRequirementKind(
  value: string,
): value is AssetRequirementKind {
  return ASSET_REQUIREMENT_KINDS.includes(value as AssetRequirementKind);
}

export function normalizeAssetRequirementKind(value: string): AssetRequirementKind {
  const normalized = value.trim().toLowerCase();

  if (!isAssetRequirementKind(normalized)) {
    throw new Error(
      `Asset requirement kind must be one of ${ASSET_REQUIREMENT_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}

export function isAssetRequirementHostKind(
  value: string,
): value is AssetRequirementHostKind {
  return ASSET_REQUIREMENT_HOST_KINDS.includes(
    value as AssetRequirementHostKind,
  );
}

export function normalizeAssetRequirementHostKind(
  value: string,
): AssetRequirementHostKind {
  const normalized = value.trim().toLowerCase();

  if (!isAssetRequirementHostKind(normalized)) {
    throw new Error(
      `Asset requirement host kind must be one of ${ASSET_REQUIREMENT_HOST_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}

export function isAssetRequirementPermissionKind(
  value: string,
): value is AssetRequirementPermissionKind {
  return ASSET_REQUIREMENT_PERMISSION_KINDS.includes(
    value as AssetRequirementPermissionKind,
  );
}

export function normalizeAssetRequirementPermissionKind(
  value: string,
): AssetRequirementPermissionKind {
  const normalized = value.trim().toLowerCase();

  if (!isAssetRequirementPermissionKind(normalized)) {
    throw new Error(
      `Asset requirement permission kind must be one of ${ASSET_REQUIREMENT_PERMISSION_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}

export function isAssetRequirementSafetyStatus(
  value: string,
): value is AssetRequirementSafetyStatus {
  return ASSET_REQUIREMENT_SAFETY_STATUSES.includes(
    value as AssetRequirementSafetyStatus,
  );
}

export function normalizeAssetRequirementSafetyStatus(
  value: string,
): AssetRequirementSafetyStatus {
  const normalized = value.trim().toLowerCase();

  if (!isAssetRequirementSafetyStatus(normalized)) {
    throw new Error(
      `Asset requirement safety status must be one of ${ASSET_REQUIREMENT_SAFETY_STATUSES.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
