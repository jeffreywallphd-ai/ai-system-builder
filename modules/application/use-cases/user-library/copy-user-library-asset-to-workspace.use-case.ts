import { normalizeAssetId, normalizeAssetReferenceKind, type AssetReference } from "../../../contracts/asset";
import {
  normalizeCopyUserLibraryAssetToWorkspaceCommand,
  type CopyUserLibraryAssetToWorkspaceCommand,
  type CopyUserLibraryAssetToWorkspaceResult,
  type UserLibraryAssetRecord,
  type UserLibraryDiagnostic,
  type UserLibraryFailure,
  createUserLibraryRelationshipId,
  createUserLibraryAssetVersion,
} from "../../../contracts/user-library";
import type {
  UserLibraryAssetRepositoryPort,
  WorkspaceUserLibraryDetachedCopyRecord,
  WorkspaceUserLibraryDetachedCopyRepositoryPort,
} from "../../ports/user-library";
import {
  containsUnsafeUserLibraryUseCaseMetadata,
  createUserLibraryDiagnostic,
  sanitizeUserLibraryUseCaseMetadata,
} from "./user-library-use-case-safety";

export interface CopyUserLibraryAssetToWorkspaceUseCaseDependencies {
  readonly userLibraryAssetRepository: UserLibraryAssetRepositoryPort;
  readonly detachedCopyRepository: WorkspaceUserLibraryDetachedCopyRepositoryPort;
  readonly generateDetachedCopyId: () => string;
  readonly generateCopiedAssetId: () => string;
  readonly now?: () => string;
}

export class CopyUserLibraryAssetToWorkspaceUseCase {
  public constructor(private readonly dependencies: CopyUserLibraryAssetToWorkspaceUseCaseDependencies) {}

  public async execute(command: CopyUserLibraryAssetToWorkspaceCommand): Promise<CopyUserLibraryAssetToWorkspaceResult> {
    let normalized: CopyUserLibraryAssetToWorkspaceCommand;
    try { normalized = normalizeCopyUserLibraryAssetToWorkspaceCommand(command); } catch {
      return failure("validation", "Copy command is invalid.", createUserLibraryDiagnostic("error", "user-library-copy-command-invalid", "Target workspace id, user-library asset reference, and selected version must be valid."));
    }
    if (containsUnsafeUserLibraryUseCaseMetadata(normalized.metadata)) {
      return failure("validation", "Copy metadata is unsafe.", createUserLibraryDiagnostic("error", "user-library-copy-metadata-unsafe", "Unsafe metadata fields were rejected."));
    }

    try {
      const asset = await this.dependencies.userLibraryAssetRepository.readUserLibraryAssetRecord(normalized.userLibraryAssetReference);
      if (!asset) return failure("not-found", "User-library asset was not found.", createUserLibraryDiagnostic("error", "user-library-copy-source-not-found", "The user-library asset reference could not be re-read."));
      if (asset.status !== "active") return failure("unavailable", "User-library asset is not active.", createUserLibraryDiagnostic("error", "user-library-copy-source-inactive", "Archived or deleting user-library assets cannot be copied."));
      if (isSystemOwnedSource(asset)) {
        return failure("validation", "System foundation assets are not eligible for detached copy.", createUserLibraryDiagnostic("error", "user-library-copy-system-foundation-forbidden", "System-owned foundation assets must not be copied into workspace-owned records."));
      }
      if (asset.version !== normalized.selectedVersion || (normalized.userLibraryAssetReference.version && normalized.userLibraryAssetReference.version !== normalized.selectedVersion)) {
        return failure("validation", "Selected user-library version is unavailable.", createUserLibraryDiagnostic("error", "user-library-copy-version-unavailable", "Selected version must match the active user-library asset version."));
      }

      const existing = await this.dependencies.detachedCopyRepository.findWorkspaceUserLibraryDetachedCopyRecord({
        targetWorkspaceId: normalized.targetWorkspaceId,
        sourceUserLibraryAssetReference: normalized.userLibraryAssetReference,
        selectedVersion: createUserLibraryAssetVersion(normalized.selectedVersion),
      });
      if (existing) {
        if (existing.status !== "active") return failure("conflict", "A detached copy already exists but is not active.", createUserLibraryDiagnostic("error", "user-library-copy-existing-inactive-conflict", "Archived or deleting copies require explicit future reactivation behavior."));
        if (isEquivalent(existing, normalized)) {
          return { ok: true, status: "existing", payload: { targetWorkspaceId: existing.targetWorkspaceId, copiedAssetReference: existing.copiedAssetReference, relationshipStatus: "detached-workspace-owned-copy" }, provenance: existing.provenance, diagnostics: [createUserLibraryDiagnostic("info", "user-library-copy-existing", "Equivalent detached workspace copy already exists.")] };
        }
        return failure("conflict", "Existing detached copy conflicts with request.", createUserLibraryDiagnostic("error", "user-library-copy-existing-conflict", "The target workspace/source/version combination already maps to a different copy identity."));
      }

      const now = this.now();
      let copiedAssetReference: AssetReference;
      let copyId;
      let selectedVersion;
      try {
        selectedVersion = createUserLibraryAssetVersion(normalized.selectedVersion);
        copiedAssetReference = {
          kind: normalizeAssetReferenceKind(asset.assetReference.kind),
          id: normalizeAssetId(this.dependencies.generateCopiedAssetId()),
          version: selectedVersion,
        };
        copyId = createUserLibraryRelationshipId(this.dependencies.generateDetachedCopyId());
      } catch {
        return failure("validation", "Generated copy identity is invalid.", createUserLibraryDiagnostic("error", "user-library-copy-generated-id-invalid", "Generated copy ids must be valid safe identifiers."));
      }
      const record: WorkspaceUserLibraryDetachedCopyRecord = {
        copyId,
        targetWorkspaceId: normalized.targetWorkspaceId,
        copiedAssetReference,
        sourceUserLibraryAssetReference: normalized.userLibraryAssetReference,
        selectedVersion,
        relationshipStatus: "detached-workspace-owned-copy",
        status: "active",
        provenance: {
          kind: "copied-from-user-library-asset",
          sourceKind: "user-library-copied",
          targetWorkspaceId: normalized.targetWorkspaceId,
          sourceUserLibraryAssetReference: normalized.userLibraryAssetReference,
          sourceAssetReference: asset.sourceAssetReference,
          sourceAssetVersion: normalized.selectedVersion,
          sourceWorkspaceId: asset.sourceWorkspaceId,
          operationAt: now,
          actorRef: normalized.requestContext?.actorRef,
          requestContext: normalized.requestContext,
          metadata: sanitizeUserLibraryUseCaseMetadata(normalized.metadata),
        },
        metadata: sanitizeUserLibraryUseCaseMetadata(normalized.metadata),
        createdAt: now,
        updatedAt: now,
      };
      const saved = await this.dependencies.detachedCopyRepository.saveWorkspaceUserLibraryDetachedCopyRecord(record);
      return { ok: true, status: "copied", payload: { targetWorkspaceId: saved.targetWorkspaceId, copiedAssetReference: saved.copiedAssetReference, relationshipStatus: "detached-workspace-owned-copy" }, provenance: saved.provenance, diagnostics: [createUserLibraryDiagnostic("info", "user-library-copy-created", "Detached workspace-owned copy was created without creating a link.")] };
    } catch {
      return failure("internal", "Copying user-library asset failed with a sanitized internal error.", createUserLibraryDiagnostic("error", "user-library-copy-internal", "An internal detached-copy workflow error occurred."));
    }
  }

  private now(): string { return (this.dependencies.now ?? (() => new Date().toISOString()))(); }
}

function isEquivalent(existing: WorkspaceUserLibraryDetachedCopyRecord, command: CopyUserLibraryAssetToWorkspaceCommand): boolean {
  return existing.targetWorkspaceId === command.targetWorkspaceId
    && existing.selectedVersion === command.selectedVersion
    && existing.sourceUserLibraryAssetReference.assetId === command.userLibraryAssetReference.assetId
    && existing.sourceUserLibraryAssetReference.version === command.userLibraryAssetReference.version;
}

function failure(code: UserLibraryFailure["code"], message: string, diag: UserLibraryDiagnostic): CopyUserLibraryAssetToWorkspaceResult {
  return { ok: false, failure: { code, message }, diagnostics: [diag] };
}


function isSystemOwnedSource(asset: UserLibraryAssetRecord): boolean {
  if (!asset.sourceWorkspaceId) return true;
  const references = [asset.sourceAssetReference, asset.assetReference, asset.provenance?.sourceAssetReference].filter(Boolean);
  if (asset.provenance?.sourceKind === "system-activated") return true;
  return references.some((reference) => String(reference?.id ?? "").startsWith("system.foundation"));
}
