import type {
  ReadSystemBuilderComposerAssetQuery,
  SystemBuilderComposerAssetDetail,
  SystemBuilderResult,
} from "../../../contracts/system-builder";
import {
  systemBuilderFailure,
  systemBuilderSuccess,
} from "../../../contracts/system-builder";
import type { AssetRegistryDefinitionReadPort } from "../../ports/asset";
import {
  readExactComposerDefinition,
  toSystemBuilderComposerAssetDetail,
} from "./system-builder-composer-projection";

export class ReadSystemBuilderComposerAssetUseCase {
  public constructor(
    private readonly definitions: AssetRegistryDefinitionReadPort,
  ) {}

  public async execute(
    query: ReadSystemBuilderComposerAssetQuery,
  ): Promise<SystemBuilderResult<SystemBuilderComposerAssetDetail>> {
    const workspaceId = String(query.workspaceId).trim();
    if (!workspaceId) {
      return systemBuilderFailure(
        "system-builder.composer-workspace-required",
        "Select a workspace before reading asset properties.",
        "workspaceId",
      );
    }
    if (
      query.definitionRef.kind !== "asset-definition-version" ||
      !String(query.definitionRef.id).trim() ||
      !query.definitionRef.version?.trim()
    ) {
      return systemBuilderFailure(
        "system-builder.composer-definition-reference-invalid",
        "Select an exact asset definition before reading its properties.",
        "definitionRef",
      );
    }

    try {
      const detail = await readExactComposerDefinition(
        this.definitions,
        workspaceId,
        query.definitionRef,
        true,
      );
      return detail
        ? systemBuilderSuccess(
            toSystemBuilderComposerAssetDetail(
              detail.definition,
              detail.builtIn,
            ),
          )
        : systemBuilderFailure(
            "system-builder.composer-definition-not-found",
            "The selected asset definition is unavailable in this workspace.",
            "definitionRef",
          );
    } catch {
      return systemBuilderFailure(
        "system-builder.composer-detail-unavailable",
        "Unable to read properties for the selected asset.",
      );
    }
  }
}
