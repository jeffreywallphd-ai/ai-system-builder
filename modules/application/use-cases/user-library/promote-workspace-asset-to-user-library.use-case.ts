import {
  createUserLibraryAssetId,
  createUserLibraryAssetVersion,
  normalizePromoteWorkspaceAssetToUserLibraryCommand,
  type PromoteWorkspaceAssetToUserLibraryCommand,
  type PromoteWorkspaceAssetToUserLibraryResult,
  type UserLibraryAssetRecord,
  type UserLibraryDiagnostic,
  type UserLibraryFailure,
} from "../../../contracts/user-library";
import type {
  UserLibraryAssetRepositoryPort,
  WorkspaceAssetForUserLibraryReadPort,
} from "../../ports/user-library";
import {
  containsUnsafeUserLibraryUseCaseMetadata,
  createUserLibraryDiagnostic,
  sanitizeUserLibraryUseCaseMetadata,
} from "./user-library-use-case-safety";

const INITIAL_USER_LIBRARY_ASSET_VERSION = "1.0.0";

export interface PromoteWorkspaceAssetToUserLibraryUseCaseDependencies {
  readonly sourceAssetReader: WorkspaceAssetForUserLibraryReadPort;
  readonly repository: UserLibraryAssetRepositoryPort;
  readonly now?: () => string;
  readonly generateUserLibraryAssetId?: () => string;
}

export class PromoteWorkspaceAssetToUserLibraryUseCase {
  public constructor(private readonly dependencies: PromoteWorkspaceAssetToUserLibraryUseCaseDependencies) {}

  public async execute(command: PromoteWorkspaceAssetToUserLibraryCommand): Promise<PromoteWorkspaceAssetToUserLibraryResult> {
    let normalized: PromoteWorkspaceAssetToUserLibraryCommand;
    try { normalized = normalizePromoteWorkspaceAssetToUserLibraryCommand(command); } catch {
      return failure("validation", "Promotion command is invalid.", createUserLibraryDiagnostic("error", "user-library-promotion-command-invalid", "Source workspace id and source asset reference are required and must be valid."));
    }

    if (normalized.originWorkspaceBehavior === "replace-with-user-library-link") {
      return failure("validation", "Origin workspace replacement with a user-library link is deferred.", createUserLibraryDiagnostic("error", "user-library-promotion-link-replacement-deferred", "replace-with-user-library-link will be implemented in the Phase 7 link prompt."));
    }

    try {
      const source = await this.dependencies.sourceAssetReader.readWorkspaceAssetForUserLibrary(normalized.sourceWorkspaceId, normalized.sourceAssetReference);
      if (!source) {
        return failure("not-found", "Source workspace asset was not found.", createUserLibraryDiagnostic("error", "user-library-promotion-source-not-found", "The source asset was re-read and is unavailable."));
      }
      if (source.sourceWorkspaceId !== normalized.sourceWorkspaceId) {
        return failure("validation", "Source asset workspace does not match the requested source workspace.", createUserLibraryDiagnostic("error", "user-library-promotion-source-workspace-mismatch", "Promotion requires a source asset owned by the requested source workspace."));
      }
      if (source.ownershipScope !== "workspace" || source.sourceKind === "system-activated") {
        return failure("validation", "Only workspace-local assets are eligible for promotion.", createUserLibraryDiagnostic("error", "user-library-promotion-source-not-workspace-local", "System-owned or unsupported source classifications are not promotable."));
      }
      if (["archived", "deleting", "invalid"].includes(source.status ?? "active")) {
        return failure("validation", "Source asset status is not eligible for promotion.", createUserLibraryDiagnostic("error", "user-library-promotion-source-status-invalid", "Archived, deleting, or invalid source assets are not promotable."));
      }
      if (containsUnsafeUserLibraryUseCaseMetadata(source.metadata)) {
        return failure("validation", "Source asset metadata is unsafe for user-library promotion.", createUserLibraryDiagnostic("error", "user-library-promotion-source-metadata-unsafe", "Unsafe source metadata fields were rejected."));
      }

      const sourceAssetVersion = normalized.sourceAssetVersion ?? source.assetVersion;
      const existing = await this.dependencies.repository.findUserLibraryAssetRecordBySource({
        sourceWorkspaceId: normalized.sourceWorkspaceId,
        sourceAssetReference: normalized.sourceAssetReference,
        sourceAssetVersion,
      });
      if (existing) {
        if (normalized.requestedUserLibraryAssetId && existing.userLibraryAssetId !== normalized.requestedUserLibraryAssetId) {
          return failure("conflict", "A promoted user-library asset already exists for the same source identity.", createUserLibraryDiagnostic("error", "user-library-promotion-existing-conflict", "Requested user-library asset id conflicts with the existing promoted record."));
        }
        return {
          ok: true,
          status: "existing",
          payload: { userLibraryAssetReference: { assetId: existing.userLibraryAssetId, version: existing.version, label: existing.displayName } },
          provenance: existing.provenance,
          diagnostics: [createUserLibraryDiagnostic("info", "user-library-promotion-existing", "An existing promoted user-library record was reused.")],
        };
      }

      const assetId = normalized.requestedUserLibraryAssetId
        ? createUserLibraryAssetId(normalized.requestedUserLibraryAssetId)
        : createUserLibraryAssetId((this.dependencies.generateUserLibraryAssetId?.() ?? ""));
      const version = createUserLibraryAssetVersion(INITIAL_USER_LIBRARY_ASSET_VERSION);
      const operationAt = this.now();
      const record: UserLibraryAssetRecord = {
        userLibraryAssetId: assetId,
        version,
        displayName: normalized.displayName ?? source.displayName ?? fallbackDisplayName(normalized.sourceAssetReference.id),
        summary: normalized.summary ?? source.summary,
        status: "active",
        sourceAssetReference: normalized.sourceAssetReference,
        sourceWorkspaceId: normalized.sourceWorkspaceId,
        sourceAssetVersion,
        // Phase 7 baseline: promoted user-library records wrap the same source reference for now.
        assetReference: { ...normalized.sourceAssetReference },
        provenance: {
          kind: "promoted-from-workspace-asset",
          sourceKind: "workspace-local",
          sourceWorkspaceId: normalized.sourceWorkspaceId,
          sourceAssetReference: normalized.sourceAssetReference,
          sourceAssetVersion,
          operationAt,
          actorRef: normalized.requestContext?.actorRef,
          requestContext: normalized.requestContext,
          metadata: sanitizeUserLibraryUseCaseMetadata(normalized.metadata),
        },
        createdAt: operationAt,
        updatedAt: operationAt,
        metadata: sanitizeUserLibraryUseCaseMetadata(normalized.metadata),
      };
      const saved = await this.dependencies.repository.saveUserLibraryAssetRecord(record);
      return {
        ok: true,
        status: "created",
        payload: { userLibraryAssetReference: { assetId: saved.userLibraryAssetId, version: saved.version, label: saved.displayName } },
        provenance: saved.provenance,
        diagnostics: [createUserLibraryDiagnostic("info", "user-library-promotion-created", "Workspace asset was promoted to the user library without mutating the source workspace asset.")],
      };
    } catch {
      return failure("internal", "Workspace asset promotion failed with a sanitized internal error.", createUserLibraryDiagnostic("error", "user-library-promotion-internal", "An internal promotion error occurred."));
    }
  }

  private now(): string { return (this.dependencies.now ?? (() => new Date().toISOString()))(); }
}

function failure(code: UserLibraryFailure["code"], message: string, diag: UserLibraryDiagnostic): PromoteWorkspaceAssetToUserLibraryResult {
  return { ok: false, failure: { code, message }, diagnostics: [diag] };
}
function fallbackDisplayName(sourceId: string): string { return sourceId; }
