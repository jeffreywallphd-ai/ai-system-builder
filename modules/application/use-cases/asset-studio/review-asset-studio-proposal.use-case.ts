import type { AssetImplementationArtifactPort } from "../../ports/asset-implementation";
import type { AssetSourceSnapshotId } from "../../../contracts/asset-implementation";
import type { AssetStudioWorkflowRepositoryPort } from "../../ports/asset-studio";
import type { SnapshotAssetImplementationSourceUseCase } from "../asset-implementation";
import { validateAssetStudioProposal } from "../../services/asset-studio";
import type { AssetStudioPatchProposal, AssetStudioResult, AssetStudioWorkflowRecord, ReviewAssetStudioProposalCommand } from "../../../contracts/asset-studio";
import { studioFailure, studioSuccess } from "./asset-studio-result";

export class ReviewAssetStudioProposalUseCase {
  public constructor(private readonly dependencies: {
    readonly workflows: AssetStudioWorkflowRepositoryPort;
    readonly artifacts: AssetImplementationArtifactPort;
    readonly snapshotSource: Pick<SnapshotAssetImplementationSourceUseCase, "execute">;
    readonly nextSnapshotId: () => AssetSourceSnapshotId;
    readonly now?: () => string;
  }) {}

  public async execute(command: ReviewAssetStudioProposalCommand): Promise<AssetStudioResult<AssetStudioWorkflowRecord>> {
    const current = await this.dependencies.workflows.read(command.workspaceId, command.workflowId);
    if (!current) return studioFailure("studio.workflow.not-found", "The authoring workflow was not found.");
    if (current.revision !== command.expectedRevision || current.status !== "proposed") return studioFailure("studio.workflow.stale", "The proposal changed or was already reviewed. Reload before continuing.");
    if (command.decision === "reject") return this.update(current, { status: "rejected", reviewedBy: command.actorId });
    let proposal: AssetStudioPatchProposal;
    let source: Uint8Array;
    try {
      source = await this.dependencies.artifacts.readVerified(command.workspaceId, current.proposalArtifact);
      proposal = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(source)) as AssetStudioPatchProposal;
    } catch {
      return studioFailure("studio.proposal.tampered", "The stored proposal could not be verified.");
    }
    const diagnostics = validateAssetStudioProposal({ proposal, allowedDependencies: command.approvedDependencies, allowedCapabilities: command.approvedCapabilities });
    if (diagnostics.some((item) => item.severity === "error") || !sameSet(proposal.dependencies, command.approvedDependencies) || !sameSet(proposal.requestedCapabilities, command.approvedCapabilities)) return studioFailure("studio.approval.mismatch", "Approval must exactly match the proposal dependencies and capabilities.", diagnostics);
    const snapshot = await this.dependencies.snapshotSource.execute({ snapshotId: this.dependencies.nextSnapshotId(), workspaceId: command.workspaceId, draftId: current.implementationDraftId, content: source, mediaType: "application/vnd.ai-system-builder.asset-source.v1+json", actorId: command.actorId });
    if (!snapshot.ok) return studioFailure(snapshot.error.code, snapshot.error.message);
    return this.update(current, { status: "snapshotted", reviewedBy: command.actorId, sourceSnapshotId: snapshot.value.snapshotId });
  }

  private async update(current: AssetStudioWorkflowRecord, changes: Pick<AssetStudioWorkflowRecord, "status"> & { readonly reviewedBy: string; readonly sourceSnapshotId?: AssetStudioWorkflowRecord["sourceSnapshotId"] }): Promise<AssetStudioResult<AssetStudioWorkflowRecord>> {
    const updatedAt = (this.dependencies.now ?? (() => new Date().toISOString()))();
    try {
      return studioSuccess(await this.dependencies.workflows.update({ ...current, ...changes, revision: current.revision + 1, updatedAt }, current.revision));
    } catch {
      return studioFailure("studio.workflow.stale", "The proposal changed while it was being reviewed.");
    }
  }
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}
