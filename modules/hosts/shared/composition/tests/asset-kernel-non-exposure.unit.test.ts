import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

const REPO_ROOT = process.cwd();

function sourceFilesUnder(relativeDir: string): readonly { path: string; source: string }[] {
  const absoluteDir = join(REPO_ROOT, relativeDir);
  const files: { path: string; source: string }[] = [];
  const stack = [absoluteDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of readdirSync(current)) {
      const absolutePath = join(current, entry);
      const stats = statSync(absolutePath);
      if (stats.isDirectory()) {
        if (entry === "node_modules" || entry === "dist" || entry === "build" || entry === "coverage") continue;
        stack.push(absolutePath);
        continue;
      }
      if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry) || /\.unit\.test\.(?:ts|tsx|js|jsx)$/.test(entry)) continue;
      files.push({ path: relative(REPO_ROOT, absolutePath), source: readFileSync(absolutePath, "utf8") });
    }
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function combinedSource(relativeDir: string): string {
  return sourceFilesUnder(relativeDir).map((file) => `\n// ${file.path}\n${file.source}`).join("\n");
}

describe("Asset Kernel public non-exposure boundaries", () => {
  it("keeps accepted package lifecycle controls bounded and marketplace/registry behavior out of public surfaces", () => {
    const publicSource = [
      combinedSource("modules/contracts/api"),
      combinedSource("modules/contracts/ipc"),
      combinedSource("modules/adapters/transport/api-express"),
      combinedSource("modules/adapters/transport/ipc-electron"),
      combinedSource("apps/desktop/src/preload"),
      combinedSource("apps/desktop/src/renderer"),
      combinedSource("apps/thin-client/src"),
      combinedSource("modules/ui/shared/asset-library"),
    ].join("\n");
    const hostCompositionSource = [
      combinedSource("modules/hosts/desktop/composition"),
      combinedSource("modules/hosts/server/composition"),
      combinedSource("modules/hosts/shared/composition"),
    ].join("\n");

    assert.match(publicSource, /\/api\/asset-packages\/inspect/i);
    assert.match(publicSource, /\/api\/asset-packages\/admit/i);
    assert.match(publicSource, /DESKTOP_ASSET_PACKAGE_OPERATIONS/);
    assert.doesNotMatch(publicSource, /\/api\/(?:packs|marketplace|package-registry)(?:\/|["'`?])/i);
    assert.doesNotMatch(publicSource, /ipc\.asset\.(?:pack|packs|resolver|override|marketplace|package-registry)/i);
    assert.doesNotMatch(publicSource, /\bresolvedDefinition\b/i);
    assert.doesNotMatch(publicSource, /\b(?:installAssetPack|installSystemFoundationPack|importAssetPack|exportAssetPack|uploadAssetPack|downloadAssetPack|publishAssetPack|activateAssetPack|disableAssetPack|resolveAssetDefinition|deleteAssetOverride|editAssetOverride)\b/i);
    assert.doesNotMatch(publicSource, /\b(?:Export pack|Download pack|Publish pack|Edit override|Delete override|Resolve asset|Resolver preview|Pack marketplace|Package registry|Visual composition|Canvas authoring|Wizard authoring)\b/i);
    assert.doesNotMatch(publicSource, /\b(?:activePackRegistry|packActivation|packPriority|marketplaceClient|packageRegistry|archivePath|archiveBytes|signatureValue|filePicker)\b/i);
    assert.doesNotMatch(hostCompositionSource, /\b(?:installSystemFoundationPack|installAssetPack|importAssetPack|exportAssetPack|activateAssetPack|disableAssetPack|resolveAssetDefinition)\s*\(/i);
    assert.doesNotMatch(hostCompositionSource, /\b(?:startup.*(?:asset|pack|foundation).*seed|(?:asset|pack|foundation).*seed.*startup|auto.*(?:asset|pack|foundation).*(?:seed|install)|(?:asset|pack|foundation).*auto.*(?:seed|install))\b/i);
  });

  it("allows only read APIs plus four approved asset mutation server API routes", () => {
    const source = [
      combinedSource("modules/contracts/api"),
      combinedSource("modules/adapters/transport/api-express"),
      combinedSource("modules/hosts/server/composition"),
    ].join("\n");

    assert.match(source, /["'`]\/api\/assets\/definitions["'`]/i);
    assert.match(source, /["'`]\/api\/assets\/definitions\/:definitionId["'`]/i);
    assert.match(source, /["'`]\/api\/assets\/definitions\/:definitionId\/versions\/:version["'`]/i);
    assert.match(source, /["'`]\/api\/assets\/resource-backed-views["'`]/i);
    assert.match(source, /["'`]\/api\/assets\/resource-backed-views\/:viewId["'`]/i);
    assert.match(source, /["'`]\/api\/assets\/register-resource-backed-view["'`]/i);
    assert.match(source, /["'`]\/api\/assets\/finalize-generated-output["'`]/i);
    assert.match(source, /["'`]\/api\/assets\/import-external-repository-object["'`]/i);
    assert.match(source, /["'`]\/api\/assets\/localize-external-repository-object["'`]/i);
    assert.doesNotMatch(source, /["'`]\/api\/assets\/(?:instances|compositions|resources|registry-summary|create|update|delete|patch|edit|seed|publish|execute|run|scan|sync|repair|install|start|train|validate)(?:\/|["'`?])/i);
    assert.doesNotMatch(source, /\.(?:put|patch|delete)\(["'`]\/api\/assets/i);
    assert.doesNotMatch(source, /\basset(?:Kernel|Registry|Library)?(?:Router|Controller)\b/i);
    assert.doesNotMatch(source, /\b(?:seedBuiltIns|registerBuiltIns|importAsset|finalizeAsset|publishAsset|executeAsset|runAsset|scanResources|syncAssets|startRuntime|probeRuntime|installRuntime|repairRuntime|trainAsset|validateAsset)\b/i);
  });

  it("allows read IPC/preload plus four approved asset mutation IPC/preload methods", () => {
    const publicIpcAndPreloadSource = [
      combinedSource("modules/contracts/ipc"),
      combinedSource("modules/adapters/transport/ipc-electron"),
      combinedSource("apps/desktop/src/preload"),
    ].join("\n");
    const desktopHostCompositionSource = combinedSource("modules/hosts/desktop/composition");

    assert.match(publicIpcAndPreloadSource, /DESKTOP_ASSET_DEFINITIONS_LIST_REQUEST_CHANNEL/);
    assert.match(publicIpcAndPreloadSource, /DESKTOP_ASSET_DEFINITION_READ_REQUEST_CHANNEL/);
    assert.match(publicIpcAndPreloadSource, /DESKTOP_ASSET_DEFINITION_VERSION_READ_REQUEST_CHANNEL/);
    assert.match(publicIpcAndPreloadSource, /DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_REQUEST_CHANNEL/);
    assert.match(publicIpcAndPreloadSource, /DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_REQUEST_CHANNEL/);
    assert.match(publicIpcAndPreloadSource, /\blistAssetDefinitions\b/);
    assert.match(publicIpcAndPreloadSource, /\breadAssetDefinition\b/);
    assert.match(publicIpcAndPreloadSource, /\blistAssetResourceBackedViews\b/);
    assert.match(publicIpcAndPreloadSource, /\breadAssetResourceBackedView\b/);
    assert.match(publicIpcAndPreloadSource, /DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_REQUEST_CHANNEL/);
    assert.match(publicIpcAndPreloadSource, /DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_REQUEST_CHANNEL/);
    assert.match(publicIpcAndPreloadSource, /DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL/);
    assert.match(publicIpcAndPreloadSource, /DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL/);
    assert.match(publicIpcAndPreloadSource, /\bregisterResourceBackedViewAsAsset\b/);
    assert.match(publicIpcAndPreloadSource, /\bfinalizeGeneratedOutputAsAsset\b/);
    assert.match(publicIpcAndPreloadSource, /\bimportExternalRepositoryObjectAsAsset\b/);
    assert.match(publicIpcAndPreloadSource, /\blocalizeExternalRepositoryObjectAsAsset\b/);
    assert.doesNotMatch(publicIpcAndPreloadSource, /ipc\.asset\.(?:instance|composition|registry-summary|create|update|delete|patch|edit|seed|publish|execute|run|scan|sync|repair|install|start|train|validate)/i);
    assert.doesNotMatch(publicIpcAndPreloadSource, /\b(?:createAsset|updateAsset|deleteAsset|patchAsset|editAsset|seedAsset|publishAsset|executeAsset|runAsset|scanAssets|syncAssets|repairAsset|installAsset|startAsset|trainAsset|validateAsset|listAssetInstances|readAssetInstance)\b/i);
    assert.match(desktopHostCompositionSource, /assetRegistryRead:\s*internalAssetRegistry\.readFacade/);
    assert.doesNotMatch(desktopHostCompositionSource, /assetRegistryRead:\s*internalAssetRegistry[,}]/);
    assert.doesNotMatch(desktopHostCompositionSource, /ipc\.asset\.(?:instance|composition|resource|registry-summary|create|update|delete|patch|edit|seed|publish|execute|run|scan|sync|repair|install|start|train|validate)/i);
  });

  it("allows Asset Library pages to expose only the four controlled mutation actions", () => {
    const rendererSourceWithoutDesktopApi = sourceFilesUnder("apps/desktop/src/renderer")
      .filter((file) => !file.path.replace(/\\/g, "/").endsWith("src/renderer/lib/desktopApi.ts"))
      .map((file) => `\n// ${file.path}\n${file.source}`)
      .join("\n");
    const sharedAssetLibrarySource = combinedSource("modules/ui/shared/asset-library");
    const source = [
      rendererSourceWithoutDesktopApi,
      combinedSource("apps/thin-client/src"),
      sharedAssetLibrarySource,
    ].join("\n");

    assert.match(source, /\bcreateDesktopAssetLibraryClient\b/);
    assert.match(source, /\bcreateApiAssetLibraryClient\b/);
    assert.match(source, /\bAssetLibraryDefinitionCard\b/);
    assert.match(rendererSourceWithoutDesktopApi, /\bAssetLibraryPage\b/);
    assert.match(rendererSourceWithoutDesktopApi, /\bAssetLibraryFeature\b/);
    assert.match(rendererSourceWithoutDesktopApi, /key:\s*["'`]assets["'`]/);
    assert.match(combinedSource("apps/thin-client/src"), /\bAssetLibraryPage\b/);
    assert.match(combinedSource("apps/thin-client/src"), /\bAssetLibraryFeature\b/);
    assert.match(combinedSource("apps/thin-client/src/routes"), /key:\s*["'`]assets["'`]/);
    assert.match(combinedSource("apps/thin-client/src/routes"), /label:\s*["'`]Assets["'`]/);
    assert.match(source, /\blistAssetDefinitions\b/);
    assert.match(source, /\breadAssetDefinition\b/);
    assert.match(source, /\blistAssetResourceBackedViews\b/);
    assert.match(source, /\breadAssetResourceBackedView\b/);
    assert.match(source, /\bregisterResourceBackedViewAsAsset\b/);
    assert.match(source, /\bfinalizeGeneratedOutputAsAsset\b/);
    assert.match(source, /\bimportExternalRepositoryObjectAsAsset\b/);
    assert.match(source, /\blocalizeExternalRepositoryObjectAsAsset\b/);
    assert.match(source, /\bRegister as asset\b/);
    assert.match(source, /\bFinalize and register\b/);
    assert.match(source, /\bImport external object\b/);
    assert.match(source, /\bLocalize external object\b/);
    assert.match(sharedAssetLibrarySource, /readDetail\(definition,\s*\{\s*\}\)/);
    assert.match(sharedAssetLibrarySource, /readDetail\(selectedDefinition,\s*\{\s*includeValidation:\s*true\s*\}\)/);
    assert.doesNotMatch(source, /\b(?:createAssetDefinition|updateAssetDefinition|deleteAssetDefinition|registerAssetDefinition|seedBuiltInAssetDefinitions|importAsset|finalizeAsset|publishAsset|scanResources|executeAsset|runAsset|syncAssets|repairAsset|installAsset|startAsset|trainAsset|bulkAsset|deleteAsset|editAsset|seedAsset)\b/i);
    assert.doesNotMatch(source, /\b(?:listAssetInstances|readAssetInstance|listAssetCompositions|readAssetComposition|readAssetRegistrySummary)\b/i);
  });

  it("keeps application asset services and shared host helpers free of forbidden outer-layer imports and storage scans", () => {
    const source = [
      combinedSource("modules/application/services/asset"),
      combinedSource("modules/application/services/asset-packs"),
      combinedSource("modules/application/use-cases/asset"),
      combinedSource("modules/hosts/shared/composition"),
    ].join("\n");

    assert.doesNotMatch(source, /from\s+["'][^"']*(?:apps\/|adapters\/transport|api-express|ipc-electron|electron|express|preload|renderer|thin-client|runtime\/.*adapter|provider-client|huggingface|openai)[^"']*["']/i);
    assert.doesNotMatch(source, /\b(?:readdir|opendir|glob|walkDir|scanResources|scanArtifacts|scanModels|scanDatasets|readBytes|readResourceBytes|fetch\(|createRuntime|startRuntime|probeRuntime|installRuntime|repairRuntime)\b/i);
    assert.doesNotMatch(source, /\b(?:PrepareTrainingDataset|DatasetPreparationUseCase|ModelTrainingPort|ModelValidationPort|ModelPublisherPort|TrainModelUseCase|ValidateModelUseCase|PublishModelUseCase|discoverModels|includeDiscovered:\s*true)\b/i);
  });

  it("allows public Phase 4 exposure only for four approved mutation operations", () => {
    const applicationUseCases = combinedSource("modules/application/use-cases/asset");
    assert.match(applicationUseCases, /asset\.register-resource-backed-view/);
    assert.match(applicationUseCases, /asset\.finalize-generated-output/);
    assert.match(applicationUseCases, /asset\.import-external-repository-object/);
    assert.match(applicationUseCases, /asset\.localize-external-repository-object/);

    const publicSource = [
      combinedSource("modules/contracts/api"),
      combinedSource("modules/contracts/ipc"),
      combinedSource("modules/adapters/transport/api-express"),
      combinedSource("modules/adapters/transport/ipc-electron"),
      combinedSource("apps/desktop/src/preload"),
      combinedSource("apps/desktop/src/renderer/features/asset-library"),
      combinedSource("apps/thin-client/src/features/asset-library"),
      combinedSource("modules/ui/shared/asset-library"),
    ].join("\n");

    assert.match(publicSource, /asset\.register-resource-backed-view/);
    assert.match(publicSource, /asset\.finalize-generated-output/);
    assert.match(publicSource, /asset\.import-external-repository-object/);
    assert.match(publicSource, /asset\.localize-external-repository-object/);
    assert.match(publicSource, /\/api\/assets\/register-resource-backed-view/);
    assert.match(publicSource, /DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_REQUEST_CHANNEL/);
    assert.doesNotMatch(publicSource, /\/api\/assets\/(?:instances|create|update|delete|patch|edit|seed|publish|execute|run|scan)(?:\/|["'`?])/i);
    assert.doesNotMatch(publicSource, /ipc\.asset\.(?:instance|create|update|delete|patch|edit|seed|publish|execute|run|scan)/i);
  });

  it("keeps the external repository resource-backed provider descriptor-only", () => {
    const source = readFileSync(
      join(REPO_ROOT, "modules/application/services/asset/asset-external-repository-resource-backed-view-provider.service.ts"),
      "utf8",
    );

    assert.doesNotMatch(source, /from\s+["'][^"']*(?:adapters\/|hosts\/|api-express|ipc-electron|electron|express|preload|renderer|thin-client|huggingface)[^"']*["']/i);
    assert.doesNotMatch(source, /\b(?:HuggingFaceRepoBrowserPort|ArtifactRepoStoragePort|CredentialStore|TokenStore|listFiles|repoInfo|download\(|upload\(|commit\(|createRepo|whoami|retrieveArtifactFromRepo|storeArtifactInRepo|hasArtifactInRepo|LocalizeArtifact|PublishArtifact|RegisterArtifact|RuntimeTaskRegistryPort|readBytes|readResourceBytes|createAssetInstance|persistMapping)\b/i);
    assert.doesNotMatch(source, /node:fs|node:path|node:http|node:https|fetch\(/i);
  });

  it("keeps every resource-backed family provider descriptor-only and free of unsafe imports/operations", () => {
    const providerFiles = [
      "modules/application/services/asset/asset-artifact-resource-backed-view-provider.service.ts",
      "modules/application/services/asset/asset-image-resource-backed-view-provider.service.ts",
      "modules/application/services/asset/asset-dataset-model-resource-backed-view-provider.service.ts",
      "modules/application/services/asset/asset-external-repository-resource-backed-view-provider.service.ts",
      "modules/application/services/asset/asset-resource-backed-view-aggregate-provider.service.ts",
    ];
    const source = providerFiles
      .map((file) => `\n// ${file}\n${readFileSync(join(REPO_ROOT, file), "utf8")}`)
      .join("\n");

    assert.doesNotMatch(source, /from\s+["'][^"']*(?:modules\/adapters|modules\/hosts|adapters\/|hosts\/|api-express|ipc-electron|contracts\/api|contracts\/ipc|electron|express|preload|renderer|thin-client|runtime\/.*adapter|storage\/.*adapter|persistence\/.*adapter|provider-client|huggingface)[^"']*["']/i);
    assert.doesNotMatch(source, /\b(?:node:fs|node:path|node:http|node:https|fetch\(|readdir|opendir|glob|walkDir|scanResources|scanArtifacts|scanModels|scanDatasets|discoverModels|listFiles|repoInfo|download\(|upload\(|commit\(|createRepo|whoami|retrieveArtifactFromRepo|storeArtifactInRepo|hasArtifactInRepo|readBytes|readResourceBytes|readContent|readArtifactContent)\b/i);
    assert.doesNotMatch(source, /\b(?:RuntimeTaskRegistryPort|runtime-readiness|startRuntime|probeRuntime|installRuntime|repairRuntime|executeRuntime|DatasetPreparationUseCase|PrepareTrainingDataset|ModelTrainingPort|TrainModelUseCase|ModelValidationPort|ValidateModelUseCase|ModelPublisherPort|PublishModelUseCase|ImageGenerationUseCase|finalizeGeneratedOutput|Finaliz\w+Generated|createAssetInstance|persistMapping|registerAsset|importAsset|localizeArtifact|publishArtifact|seedBuiltIns)\b/i);
  });

  it("keeps descriptor-source seams provider-local through host wiring", () => {
    const portSource = readFileSync(
      join(REPO_ROOT, "modules/application/ports/asset/asset-resource-backed-view-provider.port.ts"),
      "utf8",
    );
    const hostProviderCompositionSource = readFileSync(
      join(REPO_ROOT, "modules/hosts/shared/composition/composeResourceBackedViewProviders.ts"),
      "utf8",
    );
    const servicesSource = [
      "modules/application/services/asset/asset-image-resource-backed-view-provider.service.ts",
      "modules/application/services/asset/asset-dataset-model-resource-backed-view-provider.service.ts",
      "modules/application/services/asset/asset-external-repository-resource-backed-view-provider.service.ts",
    ].map((file) => readFileSync(join(REPO_ROOT, file), "utf8")).join("\n");

    assert.doesNotMatch(portSource, /\b(?:GeneratedImageOutputDescriptorSource|SafeDatasetDescriptorSource|SafeExternalRepositoryObjectDescriptorSource|SafeArtifactRepoObjectDescriptorSource)\b/);
    assert.match(hostProviderCompositionSource, /\bcomposeResourceBackedViewProviders\b/);
    assert.doesNotMatch(hostProviderCompositionSource, /from\s+["'][^"']*(?:adapters\/storage|adapters\/runtime|adapters\/transport|provider-client|huggingface|token|api-express|ipc-electron|preload|renderer|thin-client)[^"']*["']/i);
    assert.match(servicesSource, /Provider-local descriptor-only input seam/);
    assert.match(servicesSource, /Provider-local descriptor-only input seams/);
  });

  it("keeps public asset transports on the read port instead of local persistence or seeding seams", () => {
    const source = [
      combinedSource("modules/adapters/transport/api-express"),
      combinedSource("modules/adapters/transport/ipc-electron"),
      combinedSource("modules/adapters/transport/asset-registry"),
    ].join("\n");

    assert.match(source, /\bAssetRegistryDefinitionReadPort\b/);
    assert.doesNotMatch(source, /\bInternalAssetRegistryComposition\b/);
    assert.doesNotMatch(source, /\bcomposeInternalAssetRegistry\b/);
    assert.doesNotMatch(source, /from\s+["'][^"']*adapters\/persistence\/asset[^"']*["']/i);
    assert.doesNotMatch(source, /from\s+["'][^"']*built-in-asset-definition-seeding\.service[^"']*["']/i);
    assert.doesNotMatch(source, /\b(?:AssetDefinitionRepositoryPort|AssetInstanceRepositoryPort|AssetCompositionRepositoryPort|AssetBindingRepositoryPort)\b/);
    assert.doesNotMatch(source, /\b(?:RegisterAssetDefinitionUseCase|UpdateAssetDefinitionUseCase|CreateAssetInstanceUseCase|CreateAssetCompositionUseCase|BuiltInAssetDefinitionSeedingService)\b/);
  });

  it("keeps desktop renderer Asset Library files on the controlled client boundary", () => {
    const source = combinedSource("apps/desktop/src/renderer/features/asset-library");

    assert.match(source, /\bcreateDesktopAssetLibraryClient\b/);
    assert.match(source, /\blistAssetDefinitions\b/);
    assert.match(source, /\breadAssetDefinition\b/);
    assert.doesNotMatch(source, /from\s+["'][^"']*modules\/application[^"']*["']/i);
    assert.doesNotMatch(source, /from\s+["'][^"']*modules\/hosts[^"']*["']/i);
    assert.doesNotMatch(source, /from\s+["'][^"']*adapters\/persistence[^"']*["']/i);
    assert.doesNotMatch(source, /from\s+["'][^"']*ipc-electron[^"']*["']/i);
    assert.match(source, /\bregisterResourceBackedViewAsAsset\b/);
    assert.match(source, /\bfinalizeGeneratedOutputAsAsset\b/);
    assert.match(source, /\bimportExternalRepositoryObjectAsAsset\b/);
    assert.match(source, /\blocalizeExternalRepositoryObjectAsAsset\b/);
    assert.doesNotMatch(source, /\b(?:createAssetDefinition|updateAssetDefinition|deleteAssetDefinition|registerAssetDefinition|seedBuiltInAssetDefinitions|importAsset|finalizeAsset|publishAsset|scanResources|executeAsset|runAsset|syncAssets|repairAsset|installAsset|startAsset|trainAsset|bulkAsset|deleteAsset|editAsset|seedAsset)\b/i);
  });

  it("keeps thin-client Asset Library files on the server API controlled client boundary", () => {
    const source = combinedSource("apps/thin-client/src/features/asset-library");

    assert.match(source, /\bcreateApiAssetLibraryClient\b/);
    assert.match(source, /\blistAssetDefinitions\b/);
    assert.match(source, /\breadAssetDefinition\b/);
    assert.doesNotMatch(source, /from\s+["'][^"']*modules\/application[^"']*["']/i);
    assert.doesNotMatch(source, /from\s+["'][^"']*modules\/hosts[^"']*["']/i);
    assert.doesNotMatch(source, /from\s+["'][^"']*adapters\/persistence[^"']*["']/i);
    assert.doesNotMatch(source, /from\s+["'][^"']*api-express[^"']*["']/i);
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:preload|ipc-electron|electron|desktop)[^"']*["']/i);
    assert.match(source, /\bregisterResourceBackedViewAsAsset\b/);
    assert.match(source, /\bfinalizeGeneratedOutputAsAsset\b/);
    assert.match(source, /\bimportExternalRepositoryObjectAsAsset\b/);
    assert.match(source, /\blocalizeExternalRepositoryObjectAsAsset\b/);
    assert.doesNotMatch(source, /\b(?:createAssetDefinition|updateAssetDefinition|deleteAssetDefinition|registerAssetDefinition|seedBuiltInAssetDefinitions|importAsset|finalizeAsset|publishAsset|scanResources|executeAsset|runAsset|syncAssets|repairAsset|installAsset|startAsset|trainAsset|bulkAsset|deleteAsset|editAsset|seedAsset)\b/i);
  });
});
