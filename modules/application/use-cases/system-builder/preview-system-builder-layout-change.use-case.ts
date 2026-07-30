import type {
  PreviewSystemBuilderLayoutChangeCommand,
  SystemBuilderLayoutChangePreview,
  SystemBuilderResult,
} from "../../../contracts/system-builder";
import {
  systemBuilderFailure,
  systemBuilderSuccess,
} from "../../../contracts/system-builder";
import type { AssetDefinitionVersionReaderPort } from "../../ports/asset-implementation";
import type { SystemBuilderRepositoryPort } from "../../ports/system-builder";
import {
  remapSystemBuilderLayout,
  type ValidateSystemBuilderRevisionService,
} from "../../services/system-builder";

export class PreviewSystemBuilderLayoutChangeUseCase {
  public constructor(
    private readonly dependencies: {
      readonly repository: SystemBuilderRepositoryPort;
      readonly definitions: AssetDefinitionVersionReaderPort;
      readonly validator: Pick<ValidateSystemBuilderRevisionService, "execute">;
      readonly now?: () => string;
    },
  ) {}

  public async execute(
    command: PreviewSystemBuilderLayoutChangeCommand,
  ): Promise<SystemBuilderResult<SystemBuilderLayoutChangePreview>> {
    const current = await this.dependencies.repository.readRecord(
      command.workspaceId,
      command.systemId,
    );
    if (!current) {
      return systemBuilderFailure(
        "system-builder.not-found",
        "The system was not found in this workspace.",
      );
    }
    if (current.revision !== command.expectedRecordRevision) {
      return systemBuilderFailure(
        "system-builder.stale",
        "This system changed. Reload it before changing its layout.",
      );
    }
    if (
      String(current.composition.compositionId) !==
      String(command.composition.compositionId)
    ) {
      return systemBuilderFailure(
        "system-builder.composition-mismatch",
        "The composition does not belong to this system.",
      );
    }
    try {
      const preview = await remapSystemBuilderLayout(
        command,
        this.dependencies.definitions,
        this.dependencies.now?.() ?? new Date().toISOString(),
      );
      const validation = await this.dependencies.validator.execute(preview);
      return systemBuilderSuccess({
        ...preview,
        validationIssues: validation.issues,
      });
    } catch (error) {
      return systemBuilderFailure(
        "system-builder.layout-change-invalid",
        error instanceof Error
          ? error.message
          : "The layout change could not be previewed.",
        "targetLayoutPresetRef",
      );
    }
  }
}
