import type { AssetReference } from "../../../contracts/asset";
import type {
  UserLibraryAssetRecord,
  UserLibraryDiagnostic,
  UserLibraryEffectiveSourceSummary,
  WorkspaceUserLibraryLinkRecord,
} from "../../../contracts/user-library";
import type { WorkspaceId } from "../../../contracts/workspace";
import type {
  UserLibraryAssetRepositoryPort,
  WorkspaceToWorkspaceImportRecord,
  WorkspaceToWorkspaceImportRepositoryPort,
  WorkspaceUserLibraryDetachedCopyRecord,
  WorkspaceUserLibraryDetachedCopyRepositoryPort,
  WorkspaceUserLibraryLinkRepositoryPort,
} from "../../ports/user-library";

export interface WorkspaceEffectiveAssetSourceResolverDependencies {
  readonly workspaceUserLibraryLinkRepository?: WorkspaceUserLibraryLinkRepositoryPort;
  readonly userLibraryAssetRepository?: UserLibraryAssetRepositoryPort;
  readonly detachedCopyRepository?: WorkspaceUserLibraryDetachedCopyRepositoryPort;
  readonly workspaceImportRepository?: WorkspaceToWorkspaceImportRepositoryPort;
}

export class WorkspaceEffectiveAssetSourceResolver {
  public constructor(private readonly dependencies: WorkspaceEffectiveAssetSourceResolverDependencies) {}

  public async resolve(workspaceId: WorkspaceId, card: { definitionRef: AssetReference; sourcePackId?: string; sourcePackVersion?: string; sourceKind?: string; sourceLayer?: string; trustStatus?: string; systemDefault?: boolean; }): Promise<UserLibraryEffectiveSourceSummary> {
    const system = this.resolveSystemActivated(workspaceId, card);
    if (system) return system;

    const linked = await this.resolveLinked(workspaceId, card.definitionRef);
    if (linked) return linked;

    const copied = await this.resolveCopied(workspaceId, card.definitionRef);
    if (copied) return copied;

    const imported = await this.resolveImported(workspaceId, card.definitionRef);
    if (imported) return imported;

    return {
      effectiveSourceKind: "workspace-local",
      targetWorkspaceId: workspaceId,
      assetReference: card.definitionRef,
    };
  }

  private resolveSystemActivated(workspaceId: WorkspaceId, card: { definitionRef: AssetReference; sourcePackId?: string; sourcePackVersion?: string; sourceKind?: string; sourceLayer?: string; trustStatus?: string; systemDefault?: boolean; }): UserLibraryEffectiveSourceSummary | undefined {
    if (card.sourcePackId === "system.foundation" && card.sourcePackVersion === "1.0.0" && card.sourceKind === "system" && card.sourceLayer === "system-default" && card.trustStatus === "system-trusted" && card.systemDefault === true) {
      return { effectiveSourceKind: "system-activated", targetWorkspaceId: workspaceId, assetReference: card.definitionRef };
    }
    return undefined;
  }

  private async resolveLinked(workspaceId: WorkspaceId, ref: AssetReference): Promise<UserLibraryEffectiveSourceSummary | undefined> {
    if (!this.dependencies.workspaceUserLibraryLinkRepository) return undefined;
    const links = await this.dependencies.workspaceUserLibraryLinkRepository.listWorkspaceUserLibraryLinkRecords({ targetWorkspaceId: workspaceId, status: "active", limit: 250 });
    for (const link of links.links) {
      const resolved = await this.resolveLinkForRecord(workspaceId, ref, link);
      if (resolved) return resolved;
    }
    return undefined;
  }

  private async resolveLinkForRecord(workspaceId: WorkspaceId, ref: AssetReference, link: WorkspaceUserLibraryLinkRecord): Promise<UserLibraryEffectiveSourceSummary | undefined> {
    const libraryRecord = await this.dependencies.userLibraryAssetRepository?.readUserLibraryAssetRecord(link.userLibraryAssetReference);
    if (!libraryRecord) {
      return { effectiveSourceKind: "user-library-linked", targetWorkspaceId: workspaceId, assetReference: ref, userLibraryAssetReference: link.userLibraryAssetReference, relationshipKind: "link", propagationPolicy: this.propagation(link), provenance: link.provenance, diagnostics: [diag("effective-source-user-library-link-missing-source", "Linked user-library source is unavailable.")] };
    }
    if (libraryRecord.status !== "active") {
      return { effectiveSourceKind: "user-library-linked", targetWorkspaceId: workspaceId, assetReference: ref, userLibraryAssetReference: link.userLibraryAssetReference, relationshipKind: "link", propagationPolicy: this.propagation(link), provenance: link.provenance, diagnostics: [diag("effective-source-user-library-link-version-unavailable", "Linked user-library source version is unavailable.")] };
    }
    if (sameRef(libraryRecord.assetReference, ref)) {
      return { effectiveSourceKind: "user-library-linked", targetWorkspaceId: workspaceId, assetReference: ref, userLibraryAssetReference: link.userLibraryAssetReference, relationshipKind: "link", propagationPolicy: this.propagation(link), provenance: link.provenance };
    }
    return undefined;
  }

  private async resolveCopied(workspaceId: WorkspaceId, ref: AssetReference): Promise<UserLibraryEffectiveSourceSummary | undefined> {
    const repo = this.dependencies.detachedCopyRepository;
    if (!repo) return undefined;
    const list = await repo.listWorkspaceUserLibraryDetachedCopyRecords({ targetWorkspaceId: workspaceId, limit: 250 });
    const record = list.records.find((item) => sameRef(item.copiedAssetReference, ref) && item.status === "active");
    if (!record) return undefined;
    return { effectiveSourceKind: "user-library-copied", targetWorkspaceId: workspaceId, assetReference: ref, userLibraryAssetReference: record.sourceUserLibraryAssetReference, relationshipKind: "copy", provenance: record.provenance, diagnostics: hasRequiredCopyProvenance(record) ? undefined : [diag("effective-source-copy-provenance-incomplete", "Detached copy provenance is incomplete.")] };
  }

  private async resolveImported(workspaceId: WorkspaceId, ref: AssetReference): Promise<UserLibraryEffectiveSourceSummary | undefined> {
    const repo = this.dependencies.workspaceImportRepository;
    if (!repo) return undefined;
    const list = await repo.listWorkspaceToWorkspaceImportRecords({ targetWorkspaceId: workspaceId, limit: 250 });
    const record = list.records.find((item) => sameAssetIdentity(item.importedAssetReference, ref) && item.status === "active");
    if (!record) return undefined;
    return { effectiveSourceKind: "workspace-imported", targetWorkspaceId: workspaceId, sourceWorkspaceId: record.sourceWorkspaceId, assetReference: ref, sourceAssetReference: record.sourceAssetReference, relationshipKind: "workspace-import", provenance: record.provenance };
  }

  private propagation(link: WorkspaceUserLibraryLinkRecord) {
    return { policy: link.propagationPolicy, ...(link.versionSelection.version ? { selectedVersion: link.versionSelection.version } : {}), description: link.propagationPolicy === "pinned-version" ? "Pinned version link; no automatic propagation." : "Explicit update policy; propagation execution is deferred." } as const;
  }
}

function hasRequiredCopyProvenance(record: WorkspaceUserLibraryDetachedCopyRecord): boolean {
  return Boolean(record.provenance?.sourceUserLibraryAssetReference?.assetId);
}

function sameRef(left: AssetReference, right: AssetReference): boolean {
  return left.kind === right.kind && left.id === right.id && (left.version ?? "") === (right.version ?? "");
}

function diag(code: string, message: string): UserLibraryDiagnostic {
  return { severity: "warning", code, message };
}

function sameAssetIdentity(left: AssetReference, right: AssetReference): boolean {
  return left.kind === right.kind && left.id === right.id;
}
