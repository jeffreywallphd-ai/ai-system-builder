import {
  createUserLibraryLinkId,
  normalizeLinkUserLibraryAssetToWorkspaceCommand,
  type LinkUserLibraryAssetToWorkspaceCommand,
  type LinkUserLibraryAssetToWorkspaceResult,
  type UserLibraryDiagnostic,
  type UserLibraryFailure,
  type UserLibraryVersionSelection,
  type WorkspaceUserLibraryLinkRecord,
} from "../../../contracts/user-library";
import type {
  UserLibraryAssetRepositoryPort,
  WorkspaceUserLibraryLinkRepositoryPort,
} from "../../ports/user-library";
import { containsUnsafeUserLibraryUseCaseMetadata, createUserLibraryDiagnostic, sanitizeUserLibraryUseCaseMetadata } from "./user-library-use-case-safety";

export interface LinkUserLibraryAssetToWorkspaceUseCaseDependencies {
  readonly userLibraryAssetRepository: UserLibraryAssetRepositoryPort;
  readonly workspaceLinkRepository: WorkspaceUserLibraryLinkRepositoryPort;
  readonly now?: () => string;
  readonly generateUserLibraryLinkId: () => string;
}

export class LinkUserLibraryAssetToWorkspaceUseCase {
  public constructor(private readonly dependencies: LinkUserLibraryAssetToWorkspaceUseCaseDependencies) {}

  public async execute(command: LinkUserLibraryAssetToWorkspaceCommand): Promise<LinkUserLibraryAssetToWorkspaceResult> {
    let normalized: LinkUserLibraryAssetToWorkspaceCommand;
    try { normalized = normalizeLinkUserLibraryAssetToWorkspaceCommand(command); } catch {
      return failure("validation", "Link command is invalid.", createUserLibraryDiagnostic("error", "user-library-link-command-invalid", "Target workspace id, user-library asset reference, version selection, and propagation policy must be valid."));
    }

    try {
      const asset = await this.dependencies.userLibraryAssetRepository.readUserLibraryAssetRecord(normalized.userLibraryAssetReference);
      if (!asset) {
        return failure("not-found", "User-library asset was not found.", createUserLibraryDiagnostic("error", "user-library-link-source-not-found", "The user-library asset reference could not be re-read."));
      }
      if (asset.status !== "active") {
        return failure("unavailable", "User-library asset is not active.", createUserLibraryDiagnostic("error", "user-library-link-source-inactive", "Archived or deleting user-library assets cannot be linked."));
      }
      if (!isVersionSafe(normalized.versionSelection, asset.version)) {
        return failure("validation", "Requested version selection is not available.", createUserLibraryDiagnostic("error", "user-library-link-version-invalid", "Pinned or explicit version selections must refer to the active user-library asset version."));
      }
      if (containsUnsafeUserLibraryUseCaseMetadata(normalized.metadata)) {
        return failure("validation", "Link metadata is unsafe.", createUserLibraryDiagnostic("error", "user-library-link-metadata-unsafe", "Unsafe metadata fields were rejected."));
      }

      const existing = await this.dependencies.workspaceLinkRepository.findWorkspaceUserLibraryLinkRecord({
        targetWorkspaceId: normalized.targetWorkspaceId,
        userLibraryAssetReference: normalized.userLibraryAssetReference,
        propagationPolicy: normalized.propagationPolicy,
      });

      if (existing) {
        if (existing.status !== "active") {
          return failure("conflict", "A matching link exists but is not active.", createUserLibraryDiagnostic("error", "user-library-link-existing-inactive-conflict", "Archived, deleting, or disabled links require explicit future reactivation behavior."));
        }
        if (isEquivalent(existing, normalized)) {
          return { ok: true, status: "existing", payload: { linkRecord: existing }, provenance: existing.provenance, diagnostics: [createUserLibraryDiagnostic("info", "user-library-link-existing", "Equivalent workspace link already exists.")] };
        }
        return failure("conflict", "An existing workspace link conflicts with the requested semantics.", createUserLibraryDiagnostic("error", "user-library-link-existing-conflict", "The requested version selection, label, or link status conflicts with an existing link."));
      }

      const now = this.now();
      const linkId = createUserLibraryLinkId(this.dependencies.generateUserLibraryLinkId());
      const record: WorkspaceUserLibraryLinkRecord = {
        linkId,
        targetWorkspaceId: normalized.targetWorkspaceId,
        userLibraryAssetReference: normalized.userLibraryAssetReference,
        versionSelection: normalized.versionSelection,
        propagationPolicy: normalized.propagationPolicy,
        displayLabel: normalized.displayLabel,
        status: "active",
        createdAt: now,
        updatedAt: now,
        provenance: {
          kind: "linked-from-user-library-asset",
          sourceKind: "user-library-linked",
          targetWorkspaceId: normalized.targetWorkspaceId,
          sourceUserLibraryAssetReference: normalized.userLibraryAssetReference,
          operationAt: now,
          actorRef: normalized.requestContext?.actorRef,
          requestContext: normalized.requestContext,
          metadata: sanitizeUserLibraryUseCaseMetadata(normalized.metadata),
        },
        metadata: sanitizeUserLibraryUseCaseMetadata(normalized.metadata),
      };
      const saved = await this.dependencies.workspaceLinkRepository.saveWorkspaceUserLibraryLinkRecord(record);
      return { ok: true, status: "linked", payload: { linkRecord: saved }, provenance: saved.provenance, diagnostics: [createUserLibraryDiagnostic("info", "user-library-link-created", "User-library asset link was created for the target workspace.")] };
    } catch {
      return failure("internal", "Linking user-library asset failed with a sanitized internal error.", createUserLibraryDiagnostic("error", "user-library-link-internal", "An internal link workflow error occurred."));
    }
  }

  private now(): string { return (this.dependencies.now ?? (() => new Date().toISOString()))(); }
}

function isEquivalent(existing: WorkspaceUserLibraryLinkRecord, command: LinkUserLibraryAssetToWorkspaceCommand): boolean {
  return JSON.stringify(existing.versionSelection) === JSON.stringify(command.versionSelection)
    && existing.propagationPolicy === command.propagationPolicy
    && existing.targetWorkspaceId === command.targetWorkspaceId
    && existing.userLibraryAssetReference.assetId === command.userLibraryAssetReference.assetId
    && existing.userLibraryAssetReference.version === command.userLibraryAssetReference.version
    && existing.displayLabel === command.displayLabel;
}
function isVersionSafe(selection: UserLibraryVersionSelection, assetVersion: string): boolean {
  if (selection.kind === "pinned-version") return selection.version === assetVersion;
  return selection.version ? selection.version === assetVersion : true;
}
function failure(code: UserLibraryFailure["code"], message: string, diag: UserLibraryDiagnostic): LinkUserLibraryAssetToWorkspaceResult {
  return { ok: false, failure: { code, message }, diagnostics: [diag] };
}
