import type { AssetImplementationArtifactPort } from "../../ports/asset-implementation";
import type { AssetStudioWorkflowRepositoryPort } from "../../ports/asset-studio";
import type { AssetStudioPatchProposal, AssetStudioProposalView, AssetStudioResult } from "../../../contracts/asset-studio";
import type { WorkspaceId } from "../../../contracts/workspace";
import { studioFailure, studioSuccess } from "./asset-studio-result";

export class ReadAssetStudioProposalUseCase {
  public constructor(private readonly workflows: AssetStudioWorkflowRepositoryPort, private readonly artifacts: AssetImplementationArtifactPort) {}
  public async execute(workspaceId: WorkspaceId, workflowId: string): Promise<AssetStudioResult<AssetStudioProposalView>> {
    const record = await this.workflows.read(workspaceId, workflowId);
    if (!record) return studioFailure("studio.workflow.not-found", "The authoring workflow was not found.");
    try {
      const bytes = await this.artifacts.readVerified(workspaceId, record.proposalArtifact);
      return studioSuccess({ record, proposal: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as AssetStudioPatchProposal });
    } catch {
      return studioFailure("studio.proposal.tampered", "The stored proposal could not be verified.");
    }
  }
}

export class ListAssetStudioWorkflowsUseCase {
  public constructor(private readonly workflows: AssetStudioWorkflowRepositoryPort) {}
  public execute(workspaceId: WorkspaceId) { return this.workflows.list(workspaceId); }
}
