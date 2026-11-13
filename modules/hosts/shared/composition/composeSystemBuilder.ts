import type { AssetDefinitionVersionReaderPort } from "../../../application/ports/asset-implementation";
import type { AssetRegistryDefinitionReadPort } from "../../../application/ports/asset";
import type { WorkspaceAssetAccessPort } from "../../../application/ports/asset/workspace-asset-access.port";
import type { HeadlessOperationStorePort } from "../../../application/ports/system-builder";
import type { AssetReference } from "../../../contracts/asset";
import { isOrganizationId } from "../../../contracts/organization";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { ModelRegistryPort } from "../../../application/ports/model";
import {
  ArchiveSystemBuilderSystemUseCase,
  CloneSystemBuilderSystemUseCase,
  CreateSystemBuilderFromTemplateUseCase,
  CreateSystemBuilderSystemUseCase,
  HeadlessSystemAuthoringUseCase,
  ListSystemBuilderRevisionsUseCase,
  ListSystemBuilderSystemsUseCase,
  ListSystemBuilderTemplatesUseCase,
  ListSystemBuilderComposerAssetsUseCase,
  ReadSystemBuilderComposerAssetUseCase,
  ListSystemBuilderManagementUseCase,
  ListSystemBuilderModelOptionsUseCase,
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
  SystemBuilderModelAuthorityService,
  ValidateSystemBuilderRevisionService,
} from "../../../application/services/system-builder";
import { createStructuredSystemBuilderRepository } from "../../../adapters/persistence/system-builder";
import { createStructuredSystemBuildRepository } from "../../../adapters/persistence/system-build";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";

export interface ComposeSystemBuilderOptions {
  readonly documents: StructuredDocumentStore;
  readonly definitions: AssetDefinitionVersionReaderPort;
  readonly assetRegistryRead: AssetRegistryDefinitionReadPort;
  readonly modelRegistry?: Pick<
    ModelRegistryPort,
    "listModels" | "getModelRecord"
  >;
  readonly generateSystemId: () => string;
  readonly now?: () => string;
  readonly journalChanges?: boolean;
}

/** Reuse one reader on first use without constructing it for passive host discovery. */
function lazyRead<Args extends unknown[], Result>(
  create: () => { execute: (...args: Args) => Promise<Result> },
) {
  let reader: ReturnType<typeof create> | undefined;
  return { execute: (...args: Args) => (reader ??= create()).execute(...args) };
}

export function composeSystemBuilder(options: ComposeSystemBuilderOptions) {
  const repository = createStructuredSystemBuilderRepository(options.documents, { journalChanges: options.journalChanges });
  const buildRepository = createStructuredSystemBuildRepository(
    options.documents,
  );
  const modelAuthority = new SystemBuilderModelAuthorityService(
    options.modelRegistry ?? {
      async listModels() {
        throw new Error("Model Registry is unavailable.");
      },
      async getModelRecord() {
        return undefined;
      },
    },
  );
  const validator = new ValidateSystemBuilderRevisionService(
    options.definitions,
    options.now,
    modelAuthority,
  );
  const templates = new SystemBuilderReferenceTemplateRegistry();
  const dependencies = {
    repository,
    validator,
    generateSystemId: options.generateSystemId,
    now: options.now,
  };
  const readWorkspaceDefinition = async (workspaceId: WorkspaceId, reference: AssetReference) => {
    if (reference.kind !== "asset-definition-version" || !reference.version) return undefined;
    const detail = await options.assetRegistryRead.readDefinitionDetail(reference, {
      workspaceId, includeConfigurationSchema: true, includePorts: true, includeRequirements: true, includeMetadata: true,
    });
    const definition = detail?.definition;
    return definition?.definitionId === reference.id && definition.version === reference.version ? definition : undefined;
  };
  return {
    repository,
    validator,
    modelAuthority,
    composeHeadlessAuthoring(delegation: {
      readonly access: WorkspaceAssetAccessPort;
      readonly operations: HeadlessOperationStorePort;
      readonly digest: (text: string) => string;
    }) {
      const { organizationId } = options.documents;
      if (!isOrganizationId(organizationId)) throw new Error("Headless authoring requires a verified organization store.");
      return new HeadlessSystemAuthoringUseCase({
        ...dependencies, ...delegation, organizationId, templates, resolveDefinition: readWorkspaceDefinition,
        repository: createStructuredSystemBuilderRepository(options.documents.forOrganization(organizationId)),
        access: { async authorize(...args) {
          if (options.documents.organizationId !== organizationId) throw new Error("The request organization changed.");
          await delegation.access.authorize(...args);
          if (options.documents.organizationId !== organizationId) throw new Error("The request organization changed.");
        } },
        validator: (workspaceId) => new ValidateSystemBuilderRevisionService({
          readExactDefinition: (reference) => readWorkspaceDefinition(workspaceId, reference),
        }, options.now, modelAuthority),
      });
    },
    useCases: {
      create: new CreateSystemBuilderSystemUseCase(dependencies),
      listTemplates: lazyRead(() => new ListSystemBuilderTemplatesUseCase(templates)),
      createFromTemplate: new CreateSystemBuilderFromTemplateUseCase(
        dependencies,
        templates,
      ),
      list: lazyRead(() => new ListSystemBuilderSystemsUseCase(repository)),
      listManagement: new ListSystemBuilderManagementUseCase(
        repository,
        buildRepository,
      ),
      listModelOptions: new ListSystemBuilderModelOptionsUseCase(
        modelAuthority,
      ),
      read: lazyRead(() => new ReadSystemBuilderSystemUseCase(repository)),
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
