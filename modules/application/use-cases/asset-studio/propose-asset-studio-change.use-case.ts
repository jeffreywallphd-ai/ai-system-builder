import { captureStudioPropose, captureStudioProposal } from "../../services/asset-studio/capture-studio-requests";
import type { WorkspaceAssetAccessPort } from "../../ports/asset/workspace-asset-access.port";
import { requireWorkspaceAssetAccess } from "../../services/asset/workspace-asset-access.service";
import type { AssetImplementationArtifactPort, AssetImplementationRepositoryPort } from "../../ports/asset-implementation";
import type { AssetCodingModelPort, AssetStudioWorkflowRepositoryPort } from "../../ports/asset-studio";
import { validateAssetStudioProposal, validateAssetStudioRequest } from "../../services/asset-studio";
import type { ProposeAssetStudioChangeCommand, AssetStudioProposalView, AssetStudioPatchProposal, AssetStudioResult } from "../../../contracts/asset-studio";
import type { Sha256Digest } from "../../../contracts/asset-implementation";
import { studioFailure, studioSuccess } from "./asset-studio-result";

export class ProposeAssetStudioChangeUseCase {
  public constructor(private readonly dependencies: {
    readonly workspaceAccess: WorkspaceAssetAccessPort;
    readonly workflows: AssetStudioWorkflowRepositoryPort;
    readonly implementations: AssetImplementationRepositoryPort;
    readonly artifacts: AssetImplementationArtifactPort;
    readonly codingModel?: AssetCodingModelPort;
    readonly digestText: (value: string) => Sha256Digest;
    readonly now?: () => string;
    readonly timeoutMs?: number;
  }) {}

  public async execute(command: ProposeAssetStudioChangeCommand): Promise<AssetStudioResult<AssetStudioProposalView>> {
    try { command = captureStudioPropose(command); }
    catch { return studioFailure("studio.request.invalid", "The authoring request is invalid."); }
    try { await requireWorkspaceAssetAccess(this.dependencies.workspaceAccess, command.workspaceId, "asset-studio.propose", "asset:write"); }
    catch { return studioFailure("studio.workspace.forbidden", "Workspace asset access is unavailable or forbidden."); }
    const requestDiagnostics = validateAssetStudioRequest(command);
    if (requestDiagnostics.length) return studioFailure("studio.request.invalid", "The authoring request is invalid.", requestDiagnostics);
    const draft = await this.dependencies.implementations.readDraft(command.workspaceId, command.implementationDraftId);
    if (!draft || draft.definitionRef.id !== command.definitionRef.id || draft.definitionRef.version !== command.definitionRef.version) return studioFailure("studio.draft.not-found", "The exact implementation draft was not found.");
    if (await this.dependencies.workflows.read(command.workspaceId, command.workflowId)) return studioFailure("studio.workflow.conflict", "An authoring workflow already exists with this identity.");

    let proposal: AssetStudioPatchProposal;
    try {
      if (command.mode === "manual") {
        if (!command.manualProposal) return studioFailure("studio.manual-proposal.required", "Manual authoring requires a source proposal.");
        proposal = command.manualProposal;
      } else {
        if (!this.dependencies.codingModel) return studioFailure("studio.coding-model.unavailable", "No coding model provider is configured for Asset Studio.");
        proposal = captureStudioProposal(await withTimeout(this.dependencies.codingModel, captureStudioPropose(command), this.dependencies.timeoutMs ?? 120_000));
      }
    } catch (error) {
      return studioFailure(error instanceof TimeoutError ? "studio.coding-model.timeout" : "studio.coding-model.failed", error instanceof TimeoutError ? "The coding model proposal timed out." : "The coding model could not produce a valid proposal.");
    }

    const diagnostics = validateAssetStudioProposal({ proposal, allowedDependencies: command.allowedDependencies, allowedCapabilities: command.allowedCapabilities });
    if (diagnostics.some((item) => item.severity === "error")) return studioFailure("studio.proposal.invalid", "The proposed source did not pass authoring policy.", diagnostics);
    const serialized = JSON.stringify(proposal);
    const artifact = await this.dependencies.artifacts.putImmutable({ workspaceId: command.workspaceId, kind: "source", content: serialized, mediaType: "application/vnd.ai-system-builder.asset-studio-proposal.v1+json" });
    const now = (this.dependencies.now ?? (() => new Date().toISOString()))();
    const record = await this.dependencies.workflows.create({
      workflowId: command.workflowId,
      workspaceId: command.workspaceId,
      implementationDraftId: command.implementationDraftId,
      definitionRef: command.definitionRef,
      mode: command.mode,
      status: "proposed",
      intentDigest: this.dependencies.digestText(command.intent),
      proposalArtifact: artifact,
      proposalDigest: artifact.digest,
      planStepCount: proposal.plan.length,
      fileCount: proposal.files.length,
      dependencyCount: proposal.dependencies.length,
      requestedCapabilities: proposal.requestedCapabilities,
      diagnostics,
      revision: 1,
      createdBy: command.actorId,
      createdAt: now,
      updatedAt: now,
    });
    return studioSuccess({ record, proposal });
  }
}

class TimeoutError extends Error {}
async function withTimeout(model: AssetCodingModelPort, command: ProposeAssetStudioChangeCommand, timeoutMs: number): Promise<AssetStudioPatchProposal> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      model.propose({ workspaceId: command.workspaceId, definitionRef: command.definitionRef, intent: command.intent, context: command.context, allowedDependencies: command.allowedDependencies, allowedCapabilities: command.allowedCapabilities, maxOutputCharacters: 1_000_000, timeoutMs, abortSignal: controller.signal }),
      new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => { reject(new TimeoutError()); controller.abort(); }, timeoutMs); }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
