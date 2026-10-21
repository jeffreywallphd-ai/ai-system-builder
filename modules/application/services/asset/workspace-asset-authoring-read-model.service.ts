import type { AssetReference } from "../../../contracts/asset";
import type { AssetAuthoringDiagnostic, AssetAuthoringEffectiveSourceSummary, AssetOverrideRecord, AuthoredAssetRecord, AuthoredAssetRevisionRecord } from "../../../contracts/asset-authoring";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { AssetCustomizationTargetReaderPort, AssetDraftRepositoryPort, AssetOverrideRepositoryPort, AssetRevisionRepositoryPort, AuthoredAssetRepositoryPort } from "../../ports/asset-authoring";

export interface WorkspaceAssetAuthoringReadModelDependencies {
  readonly authoredAssetRepository?: AuthoredAssetRepositoryPort;
  readonly assetRevisionRepository?: AssetRevisionRepositoryPort;
  readonly assetDraftRepository?: AssetDraftRepositoryPort;
  readonly assetOverrideRepository?: AssetOverrideRepositoryPort;
  readonly customizationTargetReader?: AssetCustomizationTargetReaderPort;
}

export class WorkspaceAssetAuthoringReadModelService {
  public constructor(private readonly dependencies: WorkspaceAssetAuthoringReadModelDependencies) {}

  public async readEffectiveSourceSummary(workspaceId: WorkspaceId, assetReference: AssetReference): Promise<AssetAuthoringEffectiveSourceSummary | undefined> {
    const authored = await this.dependencies.authoredAssetRepository?.findAuthoredAssetByBaseReference(workspaceId, assetReference);
    if (authored) {
      const revision = await this.dependencies.assetRevisionRepository?.readAssetRevisionRecord(workspaceId, authored.authoredAssetId, authored.currentRevisionId);
      return authoredSummary(workspaceId, assetReference, authored, revision);
    }

    return this.readOverrideSourceSummary(workspaceId, assetReference);
  }

  private async readOverrideSourceSummary(workspaceId: WorkspaceId, assetReference: AssetReference): Promise<AssetAuthoringEffectiveSourceSummary | undefined> {
    const activeOverride = await this.dependencies.assetOverrideRepository?.findActiveOverrideForTarget(workspaceId, assetReference);
    if (activeOverride) return this.mapOverride(workspaceId, assetReference, activeOverride);

    const conflicts = await this.dependencies.assetOverrideRepository?.listConflictedOverridesByWorkspace(workspaceId);
    const conflicted = conflicts?.find((entry) => sameRef(entry.customizationTarget.effectiveAssetReference, assetReference));
    if (conflicted) {
      const base = this.mapOverride(workspaceId, assetReference, conflicted);
      return { ...base, effectiveSourceKind: "customization-conflicted", diagnostics: [...(base.diagnostics ?? []), diag("asset-authoring-override-conflicted", "Workspace override is conflicted and not applied.")] };
    }

    return undefined;
  }

  public async readEffectiveSourceSummaries(workspaceId: WorkspaceId, references: readonly AssetReference[]): Promise<readonly (AssetAuthoringEffectiveSourceSummary | undefined)[]> {
    if (!Array.isArray(references) || references.length > 250) throw new Error("Invalid bounded source references.");
    const authoredRepository = this.dependencies.authoredAssetRepository;
    const revisionRepository = this.dependencies.assetRevisionRepository;
    if (!authoredRepository?.findAuthoredAssetsByBaseReferences || !revisionRepository?.readAssetRevisionRecords) return Promise.all(references.map(reference => this.readEffectiveSourceSummary(workspaceId, reference)));
    const authored = await authoredRepository.findAuthoredAssetsByBaseReferences(workspaceId, references);
    const requestedRevisions = authored.flatMap(record => record ? [{authoredAssetId: record.authoredAssetId, revisionId: record.currentRevisionId}] : []);
    const revisions = await revisionRepository.readAssetRevisionRecords(workspaceId, requestedRevisions);
    let revisionIndex = 0;
    return Promise.all(references.map((reference, index) => {
      const record = authored[index];
      return record ? authoredSummary(workspaceId, reference, record, revisions[revisionIndex++]) : this.readOverrideSourceSummary(workspaceId, reference);
    }));
  }

  private mapOverride(workspaceId: WorkspaceId, assetReference: AssetReference, override: AssetOverrideRecord): AssetAuthoringEffectiveSourceSummary {
    const base: AssetAuthoringEffectiveSourceSummary = {
      targetWorkspaceId: workspaceId,
      effectiveSourceKind: kindFor(override.customizationTarget?.sourceKind, override.status, override.conflictStatus),
      overrideId: override.overrideId,
      assetReference,
      effectiveAssetReference: override.customizationTarget?.effectiveAssetReference,
      baseAssetReference: override.baseAssetReference,
      baseRevision: override.baseRevision,
      customizationTargetKind: override.customizationTarget?.sourceKind,
      overrideStatus: override.status,
      conflictStatus: override.conflictStatus,
      provenanceKind: override.provenance?.kind,
      diagnostics: override.status !== "active" ? [diag("asset-authoring-override-disabled", "Workspace override is inactive and not applied.")] : undefined,
    };
    return base;
  }
}

function kindFor(sourceKind: string | undefined, status: string | undefined, conflictStatus: string | undefined): AssetAuthoringEffectiveSourceSummary["effectiveSourceKind"] {
  if (status !== "active") return "customization-disabled";
  if (conflictStatus === "open") return "customization-conflicted";
  if (sourceKind === "user-library-linked-asset") return "linked-with-workspace-override";
  if (sourceKind === "user-library-copied-asset") return "copied-with-workspace-override";
  if (sourceKind === "workspace-imported-asset") return "imported-with-workspace-override";
  if (sourceKind === "system-owned-asset") return "system-derived-override";
  return "workspace-customized";
}

function diag(code: string, message: string): AssetAuthoringDiagnostic {
  return { severity: "warning", code: code as any, message };
}

function sameRef(left: AssetReference, right: AssetReference): boolean {
  return left.kind === right.kind && left.id === right.id && (left.version ?? "") === (right.version ?? "");
}

function authoredSummary(workspaceId: WorkspaceId, assetReference: AssetReference, authored: AuthoredAssetRecord, revision: AuthoredAssetRevisionRecord | undefined): AssetAuthoringEffectiveSourceSummary {
  return {
        targetWorkspaceId: workspaceId,
        effectiveSourceKind: "workspace-authored",
        authoredAssetId: authored.authoredAssetId,
        revisionId: authored.currentRevisionId,
        revisionLabel: revision?.revision,
        currentRevision: revision?.revision,
        assetReference,
        effectiveAssetReference: authored.assetReference,
        provenanceKind: authored.provenance.kind,
        diagnostics: revision ? authored.diagnostics : [...(authored.diagnostics ?? []), diag("asset-authoring-current-revision-missing", "Current authored revision is unavailable.")],
      };
}
