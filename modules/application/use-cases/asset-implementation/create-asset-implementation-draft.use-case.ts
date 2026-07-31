import {
  normalizeAssetImplementationDraft,
  type AssetImplementationDraft,
  type CreateAssetImplementationDraftCommand,
} from "../../../contracts/asset-implementation";
import type { AssetImplementationRepositoryPort } from "../../ports/asset-implementation";
import {
  implementationFailure,
  implementationSuccess,
  type AssetImplementationUseCaseResult,
} from "./asset-implementation-use-case-result";

export class CreateAssetImplementationDraftUseCase {
  public constructor(
    private readonly repository: AssetImplementationRepositoryPort,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async execute(
    command: CreateAssetImplementationDraftCommand,
  ): Promise<AssetImplementationUseCaseResult<AssetImplementationDraft>> {
    try {
      const timestamp = this.now();
      const draft = normalizeAssetImplementationDraft({
        draftId: command.draftId,
        workspaceId: command.workspaceId,
        definitionRef: command.definitionRef,
        displayName: command.displayName.trim(),
        status: "draft",
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: command.actorId,
      });
      return implementationSuccess(await this.repository.createDraft(draft));
    } catch {
      return implementationFailure(
        "implementation.draft.invalid",
        "The implementation draft is invalid or already exists.",
      );
    }
  }
}
