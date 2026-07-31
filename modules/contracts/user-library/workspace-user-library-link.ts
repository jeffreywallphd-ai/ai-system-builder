import type { AssetMetadata } from "../asset";
import type { WorkspaceId } from "../workspace";
import type { UserLibraryLinkId } from "./user-library-identity";
import type { UserLibraryPropagationPolicy } from "./user-library-propagation-policy";
import type { UserLibraryProvenanceSummary } from "./user-library-provenance";
import type { UserLibraryAssetReference } from "./user-library-source";

export const WORKSPACE_USER_LIBRARY_LINK_STATUSES = [
  "active",
  "disabled",
  "archived",
  "deleting",
] as const;

export type WorkspaceUserLibraryLinkStatus =
  (typeof WORKSPACE_USER_LIBRARY_LINK_STATUSES)[number];

export type UserLibraryVersionSelection =
  | {
      readonly kind: "pinned-version";
      readonly version: string;
    }
  | {
      readonly kind: "explicit-update";
      readonly version?: string;
    };

export interface WorkspaceUserLibraryLinkRecord {
  readonly linkId: UserLibraryLinkId;
  readonly targetWorkspaceId: WorkspaceId;
  readonly userLibraryAssetReference: UserLibraryAssetReference;
  readonly versionSelection: UserLibraryVersionSelection;
  readonly propagationPolicy: UserLibraryPropagationPolicy;
  readonly displayLabel?: string;
  readonly status: WorkspaceUserLibraryLinkStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly provenance: UserLibraryProvenanceSummary;
  readonly metadata?: AssetMetadata;
}

export function isWorkspaceUserLibraryLinkStatus(
  value: string,
): value is WorkspaceUserLibraryLinkStatus {
  return WORKSPACE_USER_LIBRARY_LINK_STATUSES.includes(
    value as WorkspaceUserLibraryLinkStatus,
  );
}
