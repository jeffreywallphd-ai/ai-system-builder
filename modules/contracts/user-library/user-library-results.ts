import type { AssetReference } from "../asset";
import type { WorkspaceId } from "../workspace";
import type { UserLibraryDiagnostic, UserLibraryFailure } from "./user-library-diagnostics";
import type { UserLibraryProvenanceSummary } from "./user-library-provenance";
import type { UserLibraryAssetReference } from "./user-library-source";
import type { WorkspaceUserLibraryLinkRecord } from "./workspace-user-library-link";

export const USER_LIBRARY_OPERATION_RESULT_STATUSES = [
  "created",
  "existing",
  "linked",
  "copied",
  "imported",
  "skipped",
] as const;

export type UserLibraryOperationResultStatus =
  (typeof USER_LIBRARY_OPERATION_RESULT_STATUSES)[number];

type UserLibraryOperationSuccess<TStatus extends UserLibraryOperationResultStatus, TPayload> = {
  readonly ok: true;
  readonly status: TStatus;
  readonly payload: TPayload;
  readonly provenance?: UserLibraryProvenanceSummary;
  readonly diagnostics?: readonly UserLibraryDiagnostic[];
};

type UserLibraryOperationFailureResult = {
  readonly ok: false;
  readonly failure: UserLibraryFailure;
  readonly diagnostics?: readonly UserLibraryDiagnostic[];
  readonly provenance?: UserLibraryProvenanceSummary;
};

export type PromoteWorkspaceAssetToUserLibraryResult =
  | UserLibraryOperationSuccess<"created" | "existing" | "skipped", { readonly userLibraryAssetReference: UserLibraryAssetReference }>
  | UserLibraryOperationFailureResult;

export type LinkUserLibraryAssetToWorkspaceResult =
  | UserLibraryOperationSuccess<"linked" | "existing" | "skipped", { readonly linkRecord: WorkspaceUserLibraryLinkRecord }>
  | UserLibraryOperationFailureResult;

export type CopyUserLibraryAssetToWorkspaceResult =
  | UserLibraryOperationSuccess<"copied" | "existing" | "skipped", {
      readonly targetWorkspaceId: WorkspaceId;
      readonly copiedAssetReference: AssetReference;
      readonly relationshipStatus: "detached-workspace-owned-copy";
    }>
  | UserLibraryOperationFailureResult;

export type ImportWorkspaceAssetToWorkspaceResult =
  | UserLibraryOperationSuccess<"imported" | "existing" | "skipped", {
      readonly sourceWorkspaceId: WorkspaceId;
      readonly targetWorkspaceId: WorkspaceId;
      readonly importedAssetReference: AssetReference;
      readonly relationshipStatus: "detached-workspace-owned-copy";
    }>
  | UserLibraryOperationFailureResult;

export function isUserLibraryOperationResultStatus(
  value: string,
): value is UserLibraryOperationResultStatus {
  return USER_LIBRARY_OPERATION_RESULT_STATUSES.includes(
    value as UserLibraryOperationResultStatus,
  );
}
