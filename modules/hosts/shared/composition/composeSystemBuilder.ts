import type { AssetDefinitionVersionReaderPort } from "../../../application/ports/asset-implementation";
import type { AssetRegistryDefinitionReadPort } from "../../../application/ports/asset";
import {
  ArchiveSystemBuilderSystemUseCase,
  CloneSystemBuilderSystemUseCase,
  CreateSystemBuilderFromTemplateUseCase,
  CreateSystemBuilderSystemUseCase,
  ListSystemBuilderRevisionsUseCase,
  ListSystemBuilderSystemsUseCase,
  ListSystemBuilderTemplatesUseCase,
  ListSystemBuilderComposerAssetsUseCase,
  ReadSystemBuilderComposerAssetUseCase,
  ListSystemBuilderManagementUseCase,
  ReadSystemBuilderRevisionUseCase,
  PreviewSystemBuilderLayoutChangeUseCase,
  ReadSystemBuilderSystemUseCase,
  RenameSystemBuilderSystemUseCase,
  RestoreSystemBuilderSystemUseCase,
  SaveSystemBuilderRevisionUseCase,
  PreviewSystemBuilderFoundationUpgradeUseCase,
  UpgradeSystemBuilderFoundationUseCase,
} from "../../../application/use-cases/system-builder";
import {
  SystemBuilderReferenceTemplateRegistry,
  ValidateSystemBuilderRevisionService,
} from "../../../application/services/system-builder";
import { createStructuredSystemBuilderRepository } from "../../../adapters/persistence/system-builder";
import { createStructuredSystemBuildRepository } from "../../../adapters/persistence/system-build";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";

export interface ComposeSystemBuilderOptions {
  readonly documents: StructuredDocumentStore;
  readonly definitions: AssetDefinitionVersionReaderPort;
  readonly assetRegistryRead: AssetRegistryDefinitionReadPort;
  readonly generateSystemId: () => string;
  readonly now?: () => string;
}

export function composeSystemBuilder(options: ComposeSystemBuilderOptions) {
  const repository = createStructuredSystemBuilderRepository(options.documents);
  const buildRepository = createStructuredSystemBuildRepository(
    options.documents,
  );
  const validator = new ValidateSystemBuilderRevisionService(
    options.definitions,
    options.now,
  );
  const templates = new SystemBuilderReferenceTemplateRegistry();
  const dependencies = {
    repository,
    validator,
    generateSystemId: options.generateSystemId,
    now: options.now,
  };
  return {
    repository,
    validator,
    useCases: {
      create: new CreateSystemBuilderSystemUseCase(dependencies),
      listTemplates: new ListSystemBuilderTemplatesUseCase(templates),
      createFromTemplate: new CreateSystemBuilderFromTemplateUseCase(
        dependencies,
        templates,
      ),
      list: new ListSystemBuilderSystemsUseCase(repository),
      listManagement: new ListSystemBuilderManagementUseCase(
        repository,
        buildRepository,
      ),
      read: new ReadSystemBuilderSystemUseCase(repository),
      rename: new RenameSystemBuilderSystemUseCase(dependencies),
      archive: new ArchiveSystemBuilderSystemUseCase(dependencies),
      restore: new RestoreSystemBuilderSystemUseCase(dependencies),
      clone: new CloneSystemBuilderSystemUseCase(dependencies),
      saveRevision: new SaveSystemBuilderRevisionUseCase(dependencies),
      readRevision: new ReadSystemBuilderRevisionUseCase(repository),
      listRevisions: new ListSystemBuilderRevisionsUseCase(repository),
      listComposerAssets: new ListSystemBuilderComposerAssetsUseCase(
        options.assetRegistryRead,
      ),
      readComposerAsset: new ReadSystemBuilderComposerAssetUseCase(
        options.assetRegistryRead,
      ),
      previewLayoutChange: new PreviewSystemBuilderLayoutChangeUseCase({
        repository,
        definitions: options.definitions,
        validator,
        now: options.now,
      }),
      previewFoundationUpgrade:
        new PreviewSystemBuilderFoundationUpgradeUseCase({
          repository,
          validator,
          now: options.now,
        }),
      upgradeFoundation: new UpgradeSystemBuilderFoundationUseCase({
        repository,
        validator,
        now: options.now,
      }),
    },
  };
}

export type SystemBuilderCompositionRoot = ReturnType<
  typeof composeSystemBuilder
>;
