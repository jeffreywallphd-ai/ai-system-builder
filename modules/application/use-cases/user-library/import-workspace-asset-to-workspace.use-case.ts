import { normalizeAssetId, normalizeAssetReferenceKind } from "../../../contracts/asset";
import {
  createUserLibraryRelationshipId,
  createUserLibraryAssetVersion,
  normalizeImportWorkspaceAssetToWorkspaceCommand,
  type ImportWorkspaceAssetToWorkspaceCommand,
  type ImportWorkspaceAssetToWorkspaceResult,
  type UserLibraryAssetVersion,
  type UserLibraryDiagnostic,
  type UserLibraryFailure,
} from "../../../contracts/user-library";
import type {
  WorkspaceAssetForUserLibraryDescriptor,
  WorkspaceAssetForUserLibraryReadPort,
  WorkspaceToWorkspaceImportRecord,
  WorkspaceToWorkspaceImportRepositoryPort,
} from "../../ports/user-library";
import { containsUnsafeUserLibraryUseCaseMetadata, createUserLibraryDiagnostic, sanitizeUserLibraryUseCaseMetadata } from "./user-library-use-case-safety";

export interface ImportWorkspaceAssetToWorkspaceUseCaseDependencies {
  readonly sourceAssetReader: WorkspaceAssetForUserLibraryReadPort;
  readonly importRepository: WorkspaceToWorkspaceImportRepositoryPort;
  readonly generateImportId: () => string;
  readonly generateImportedAssetId: () => string;
  readonly now?: () => string;
}

export class ImportWorkspaceAssetToWorkspaceUseCase {
  public constructor(private readonly dependencies: ImportWorkspaceAssetToWorkspaceUseCaseDependencies) {}

  public async execute(command: ImportWorkspaceAssetToWorkspaceCommand): Promise<ImportWorkspaceAssetToWorkspaceResult> {
    let normalized: ImportWorkspaceAssetToWorkspaceCommand;
    try { normalized = normalizeImportWorkspaceAssetToWorkspaceCommand(command); } catch {
      return failure("validation", "Import command is invalid.", createUserLibraryDiagnostic("error", "workspace-import-command-invalid", "Source workspace id, target workspace id, and source asset reference must be valid."));
    }
    if (normalized.sourceWorkspaceId === normalized.targetWorkspaceId) return failure("validation", "Source and target workspace must differ.", createUserLibraryDiagnostic("error", "workspace-import-same-workspace-forbidden", "Detached workspace import requires different source and target workspaces."));
    if (containsUnsafeUserLibraryUseCaseMetadata(normalized.metadata)) return failure("validation", "Import metadata is unsafe.", createUserLibraryDiagnostic("error", "workspace-import-metadata-unsafe", "Unsafe metadata fields were rejected."));

    try {
      const source = await this.dependencies.sourceAssetReader.readWorkspaceAssetForUserLibrary(normalized.sourceWorkspaceId, normalized.sourceAssetReference);
      if (!source) return failure("not-found", "Source workspace asset was not found.", createUserLibraryDiagnostic("error", "workspace-import-source-not-found", "The source workspace asset could not be re-read."));
      if (source.sourceWorkspaceId !== normalized.sourceWorkspaceId) return failure("conflict", "Source workspace mismatch.", createUserLibraryDiagnostic("error", "workspace-import-source-workspace-mismatch", "Re-read source asset does not belong to the requested source workspace."));
      if (isRejectedSource(source)) return failure("validation", "Source asset is not eligible for workspace import.", createUserLibraryDiagnostic("error", "workspace-import-source-ineligible", "System-owned, linked, imported, unknown, invalid, or unsupported source assets cannot be imported."));
      if (source.status && source.status !== "active") return failure("unavailable", "Source asset is not active.", createUserLibraryDiagnostic("error", "workspace-import-source-inactive", "Archived, deleting, or invalid source assets cannot be imported."));
      if (containsUnsafeUserLibraryUseCaseMetadata(source.metadata)) return failure("validation", "Source asset metadata is unsafe.", createUserLibraryDiagnostic("error", "workspace-import-source-metadata-unsafe", "Unsafe source metadata fields were rejected."));

      const selectedVersion: UserLibraryAssetVersion | undefined = normalized.sourceAssetVersion ? createUserLibraryAssetVersion(normalized.sourceAssetVersion) : (source.assetVersion ? createUserLibraryAssetVersion(source.assetVersion) : undefined);
      const existing = await this.dependencies.importRepository.findWorkspaceToWorkspaceImportRecord({ sourceWorkspaceId: normalized.sourceWorkspaceId, targetWorkspaceId: normalized.targetWorkspaceId, sourceAssetReference: normalized.sourceAssetReference, sourceAssetVersion: selectedVersion });
      if (existing) {
        if (existing.status !== "active") return failure("conflict", "Existing import is not active.", createUserLibraryDiagnostic("error", "workspace-import-existing-inactive-conflict", "Archived or deleting imports require explicit future reactivation behavior."));
        if (equivalent(existing, normalized, selectedVersion)) {
          return { ok: true, status: "existing", payload: { sourceWorkspaceId: existing.sourceWorkspaceId, targetWorkspaceId: existing.targetWorkspaceId, importedAssetReference: existing.importedAssetReference, relationshipStatus: "detached-workspace-owned-copy" }, provenance: existing.provenance, diagnostics: [createUserLibraryDiagnostic("info", "workspace-import-existing", "Equivalent detached workspace import already exists.")] };
        }
        return failure("conflict", "Existing import conflicts with request.", createUserLibraryDiagnostic("error", "workspace-import-existing-conflict", "The target workspace/source identity already maps to a different import copy."));
      }

      const now = this.now();
      let importId; let importedAssetReference;
      try {
        importId = createUserLibraryRelationshipId(this.dependencies.generateImportId());
        importedAssetReference = { kind: normalizeAssetReferenceKind(source.assetReference.kind), id: normalizeAssetId(this.dependencies.generateImportedAssetId()), version: selectedVersion };
      } catch { return failure("validation", "Generated import identity is invalid.", createUserLibraryDiagnostic("error", "workspace-import-generated-id-invalid", "Generated import ids must be valid safe identifiers.")); }

      const saved = await this.dependencies.importRepository.saveWorkspaceToWorkspaceImportRecord({
        importId,
        sourceWorkspaceId: normalized.sourceWorkspaceId,
        targetWorkspaceId: normalized.targetWorkspaceId,
        sourceAssetReference: normalized.sourceAssetReference,
        sourceAssetVersion: selectedVersion,
        importedAssetReference,
        relationshipStatus: "detached-workspace-owned-copy",
        status: "active",
        provenance: { kind: "imported-from-workspace-asset", sourceKind: "workspace-imported", sourceWorkspaceId: normalized.sourceWorkspaceId, targetWorkspaceId: normalized.targetWorkspaceId, sourceAssetReference: normalized.sourceAssetReference, sourceAssetVersion: selectedVersion, operationAt: now, actorRef: normalized.requestContext?.actorRef, requestContext: normalized.requestContext, metadata: sanitizeUserLibraryUseCaseMetadata(normalized.metadata) },
        metadata: sanitizeUserLibraryUseCaseMetadata(normalized.metadata), createdAt: now, updatedAt: now,
      });
      return { ok: true, status: "imported", payload: { sourceWorkspaceId: saved.sourceWorkspaceId, targetWorkspaceId: saved.targetWorkspaceId, importedAssetReference: saved.importedAssetReference, relationshipStatus: "detached-workspace-owned-copy" }, provenance: saved.provenance, diagnostics: [createUserLibraryDiagnostic("info", "workspace-import-created", "Detached import copy was created without creating a live workspace link.")] };
    } catch {
      return failure("internal", "Importing workspace asset failed with a sanitized internal error.", createUserLibraryDiagnostic("error", "workspace-import-internal", "An internal workspace import workflow error occurred."));
    }
  }
  private now(): string { return (this.dependencies.now ?? (() => new Date().toISOString()))(); }
}

function isRejectedSource(source: WorkspaceAssetForUserLibraryDescriptor): boolean {
  if (source.ownershipScope !== "workspace") return true;
  if (!source.sourceKind || source.sourceKind === "unsupported") return true;
  if (source.sourceKind === "system-activated" || source.sourceKind === "user-library-linked" || source.sourceKind === "user-library-copied" || source.sourceKind === "workspace-imported") return true;
  const all = [source.assetReference.id, source.metadata?.sourceAssetId, source.metadata?.sourcePackId].filter(Boolean).map(String);
  return all.some((value) => value.startsWith("system.foundation"));
}

function equivalent(existing: WorkspaceToWorkspaceImportRecord, command: ImportWorkspaceAssetToWorkspaceCommand, selectedVersion?: UserLibraryAssetVersion): boolean {
  return existing.sourceWorkspaceId === command.sourceWorkspaceId && existing.targetWorkspaceId === command.targetWorkspaceId && existing.sourceAssetReference.id === command.sourceAssetReference.id && existing.sourceAssetReference.kind === command.sourceAssetReference.kind && (existing.sourceAssetVersion ?? undefined) === selectedVersion;
}

function failure(code: UserLibraryFailure["code"], message: string, diag: UserLibraryDiagnostic): ImportWorkspaceAssetToWorkspaceResult { return { ok: false, failure: { code, message }, diagnostics: [diag] }; }
