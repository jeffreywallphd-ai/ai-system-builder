import { captureStudioStart } from "../../services/asset-studio/capture-studio-requests";
import type { WorkspaceAssetAccessPort } from "../../ports/asset/workspace-asset-access.port";
import { requireWorkspaceAssetAccess } from "../../services/asset/workspace-asset-access.service";
import type { AssetImplementationDraft, AssetImplementationDraftId } from "../../../contracts/asset-implementation";
import type { AssetStudioResult, StartAssetStudioCommand } from "../../../contracts/asset-studio";
import type { CreateAssetImplementationDraftUseCase } from "../asset-implementation";
import { studioFailure, studioSuccess } from "./asset-studio-result";

export class StartAssetStudioUseCase {
  public constructor(private readonly createDraft: Pick<CreateAssetImplementationDraftUseCase, "execute">, private readonly nextDraftId: () => AssetImplementationDraftId, private readonly workspaceAccess: WorkspaceAssetAccessPort) {}
  public async execute(command: StartAssetStudioCommand): Promise<AssetStudioResult<AssetImplementationDraft>> {
    try { command = captureStudioStart(command); }
    catch { return studioFailure("studio.request.invalid", "The authoring request is invalid."); }
    try { await requireWorkspaceAssetAccess(this.workspaceAccess, command.workspaceId, "asset-studio.start", "asset:write"); }
    catch { return studioFailure("studio.workspace.forbidden", "Workspace asset access is unavailable or forbidden."); }
    if (!command.displayName.trim()) return studioFailure("studio.display-name.required", "A display name is required.");
    const result = await this.createDraft.execute({ draftId: this.nextDraftId(), workspaceId: command.workspaceId, definitionRef: command.definitionRef, displayName: command.displayName, actorId: command.actorId });
    return result.ok ? studioSuccess(result.value) : studioFailure(result.error.code, result.error.message);
  }
}
