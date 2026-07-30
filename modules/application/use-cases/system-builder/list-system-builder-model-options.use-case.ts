import {
  systemBuilderFailure,
  systemBuilderSuccess,
  type ListSystemBuilderModelOptionsQuery,
  type SystemBuilderModelOptionCatalog,
  type SystemBuilderResult,
} from "../../../contracts/system-builder";
import type { SystemBuilderModelAuthorityService } from "../../services/system-builder";

export class ListSystemBuilderModelOptionsUseCase {
  public constructor(
    private readonly authority: SystemBuilderModelAuthorityService,
  ) {}

  public async execute(
    query: ListSystemBuilderModelOptionsQuery,
  ): Promise<SystemBuilderResult<SystemBuilderModelOptionCatalog>> {
    try {
      return systemBuilderSuccess({
        options: await this.authority.listCompatible(query.workspaceId),
      });
    } catch {
      return systemBuilderFailure(
        "unavailable",
        "Compatible models are unavailable for this workspace.",
      );
    }
  }
}
