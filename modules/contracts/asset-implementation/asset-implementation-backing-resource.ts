import type { AssetReference } from "../asset";
import type { WorkspaceId } from "../workspace";
import type { AssetImplementationArtifactDescriptor } from "./asset-implementation-artifact";
import type {
  AssetImplementationReleaseId,
  AssetSourceSnapshotId,
} from "./asset-implementation-identity";

export const ASSET_IMPLEMENTATION_BACKING_RESOURCE_MEDIA_TYPE =
  "application/vnd.ai-system-builder.implementation-backing-resources.v1+json" as const;

export const ASSET_IMPLEMENTATION_BACKING_RESOURCE_ROLES = [
  "frontend-structure",
  "frontend-style",
  "backend-logic",
  "other",
] as const;

export type AssetImplementationBackingResourceRole =
  (typeof ASSET_IMPLEMENTATION_BACKING_RESOURCE_ROLES)[number];

export const ASSET_IMPLEMENTATION_BACKING_RESOURCE_ORIGINS = [
  "system-foundation",
  "admitted-package",
  "authored",
  "derived-customization",
] as const;

export type AssetImplementationBackingResourceOrigin =
  (typeof ASSET_IMPLEMENTATION_BACKING_RESOURCE_ORIGINS)[number];

export interface AssetImplementationBackingResourceFile {
  readonly path: string;
  readonly role: AssetImplementationBackingResourceRole;
  readonly mediaType: string;
  readonly content: string;
}

/** Raw paths and content remain inside the authorized artifact seam. */
export interface AssetImplementationBackingResourceBundleV1 {
  readonly formatVersion: "1.0";
  readonly files: readonly AssetImplementationBackingResourceFile[];
}

export interface AssetImplementationBackingResourceFileDescriptor {
  readonly path: string;
  readonly role: AssetImplementationBackingResourceRole;
  readonly mediaType: string;
  readonly sizeCharacters: number;
  readonly editable: boolean;
}

/** Safe structured link from one exact release to its immutable backing bundle. */
export interface AssetImplementationBackingResourceRecord {
  readonly backingResourceId: string;
  readonly origin: AssetImplementationBackingResourceOrigin;
  readonly releaseId: AssetImplementationReleaseId;
  readonly definitionRef: AssetReference;
  readonly scope: "system" | "workspace";
  readonly workspaceId?: WorkspaceId;
  readonly artifactWorkspaceId: WorkspaceId;
  readonly sourceSnapshotId: AssetSourceSnapshotId;
  readonly artifact: AssetImplementationArtifactDescriptor;
  readonly files: readonly AssetImplementationBackingResourceFileDescriptor[];
  readonly createdAt: string;
  readonly createdBy: string;
}
