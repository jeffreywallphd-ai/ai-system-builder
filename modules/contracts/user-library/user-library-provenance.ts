import type { AssetMetadata, AssetReference } from "../asset";
import type { WorkspaceActorReference, WorkspaceId } from "../workspace";
import type { UserLibraryAssetReference, UserLibrarySourceKind } from "./user-library-source";
import type { UserLibraryOperationId, UserLibraryRelationshipId } from "./user-library-identity";

export const USER_LIBRARY_PROVENANCE_KINDS = [
  "promoted-from-workspace-asset",
  "linked-from-user-library-asset",
  "copied-from-user-library-asset",
  "imported-from-workspace-asset",
] as const;

export type UserLibraryProvenanceKind =
  (typeof USER_LIBRARY_PROVENANCE_KINDS)[number];

export interface UserLibraryRequestContext {
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly idempotencyKey?: string;
  readonly requestedAt?: string;
}

export interface UserLibraryActorRequestContext extends UserLibraryRequestContext {
  readonly actorRef?: WorkspaceActorReference;
}

export interface UserLibraryProvenanceSummary {
  readonly kind: UserLibraryProvenanceKind;
  readonly sourceKind?: UserLibrarySourceKind;
  readonly sourceWorkspaceId?: WorkspaceId;
  readonly targetWorkspaceId?: WorkspaceId;
  readonly sourceAssetReference?: AssetReference;
  readonly sourceAssetVersion?: string;
  readonly sourceUserLibraryAssetReference?: UserLibraryAssetReference;
  readonly relationshipId?: UserLibraryRelationshipId;
  readonly operationId?: UserLibraryOperationId;
  readonly operationAt: string;
  readonly actorRef?: WorkspaceActorReference;
  readonly requestContext?: UserLibraryRequestContext;
  readonly metadata?: AssetMetadata;
}

export function isUserLibraryProvenanceKind(
  value: string,
): value is UserLibraryProvenanceKind {
  return USER_LIBRARY_PROVENANCE_KINDS.includes(value as UserLibraryProvenanceKind);
}
