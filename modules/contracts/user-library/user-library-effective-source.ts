import type { AssetReference } from "../asset";
import type { WorkspaceId } from "../workspace";
import type { UserLibraryDiagnostic } from "./user-library-diagnostics";
import type { UserLibraryPropagationPolicySummary } from "./user-library-propagation-policy";
import type { UserLibraryProvenanceSummary } from "./user-library-provenance";
import type { UserLibraryAssetReference, UserLibrarySourceKind } from "./user-library-source";

export const USER_LIBRARY_EFFECTIVE_SOURCE_KINDS = [
  "system-activated",
  "workspace-local",
  "user-library-linked",
  "user-library-copied",
  "workspace-imported",
] as const;

export type UserLibraryEffectiveSourceKind =
  (typeof USER_LIBRARY_EFFECTIVE_SOURCE_KINDS)[number];

export interface UserLibraryEffectiveSourceSummary {
  readonly effectiveSourceKind: UserLibraryEffectiveSourceKind;
  readonly originalSourceKind?: UserLibrarySourceKind;
  readonly targetWorkspaceId: WorkspaceId;
  readonly sourceWorkspaceId?: WorkspaceId;
  readonly assetReference: AssetReference;
  readonly sourceAssetReference?: AssetReference;
  readonly userLibraryAssetReference?: UserLibraryAssetReference;
  readonly relationshipKind?: "link" | "copy" | "workspace-import";
  readonly propagationPolicy?: UserLibraryPropagationPolicySummary;
  readonly provenance?: UserLibraryProvenanceSummary;
  readonly diagnostics?: readonly UserLibraryDiagnostic[];
}

export function isUserLibraryEffectiveSourceKind(
  value: string,
): value is UserLibraryEffectiveSourceKind {
  return USER_LIBRARY_EFFECTIVE_SOURCE_KINDS.includes(
    value as UserLibraryEffectiveSourceKind,
  );
}
