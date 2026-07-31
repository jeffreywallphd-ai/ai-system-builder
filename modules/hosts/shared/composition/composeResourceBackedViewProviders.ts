import type { ArtifactBrowserMetadataReadPort } from "../../../application/ports/artifact-browser";
import {
  createUnsupportedAssetResourceBackedViewProvider,
  type AssetResourceBackedViewProvider,
} from "../../../application/ports/asset";
import type { ImageAssetDescriptorReadPort } from "../../../application/ports/image";
import type { ModelRegistryPort } from "../../../application/ports/model";
import { createAssetResourceBackedViewAggregateProvider } from "../../../application/services/asset/asset-resource-backed-view-aggregate-provider.service";
import { createArtifactResourceBackedViewProvider } from "../../../application/services/asset/asset-artifact-resource-backed-view-provider.service";
import {
  createAssetImageResourceBackedViewProvider,
  type GeneratedImageOutputDescriptorSource,
} from "../../../application/services/asset/asset-image-resource-backed-view-provider.service";
import {
  createAssetDatasetModelResourceBackedViewProvider,
  type SafeDatasetDescriptorSource,
} from "../../../application/services/asset/asset-dataset-model-resource-backed-view-provider.service";
import {
  createAssetExternalRepositoryResourceBackedViewProvider,
  type SafeArtifactRepoObjectDescriptorSource,
  type SafeArtifactStorageBindingSource,
  type SafeExternalRepositoryObjectDescriptorSource,
} from "../../../application/services/asset/asset-external-repository-resource-backed-view-provider.service";

export interface ComposeResourceBackedViewProvidersOptions {
  readonly artifactBrowserMetadataRead?: Pick<ArtifactBrowserMetadataReadPort, "browseArtifacts">;
  readonly imageAssetDescriptorRead?: ImageAssetDescriptorReadPort;
  readonly generatedImageOutputDescriptorSource?: GeneratedImageOutputDescriptorSource;
  readonly datasetDescriptorSource?: SafeDatasetDescriptorSource;
  readonly modelRegistry?: Pick<ModelRegistryPort, "listModels" | "getModelRecord">;
  readonly externalRepositoryObjectDescriptorSource?: SafeExternalRepositoryObjectDescriptorSource;
  readonly artifactRepoObjectDescriptorSource?: SafeArtifactRepoObjectDescriptorSource;
  readonly artifactStorageBindingSource?: SafeArtifactStorageBindingSource;
  readonly publishedModelRegistry?: Pick<ModelRegistryPort, "listModels" | "getModelRecord">;
}

export function composeResourceBackedViewProviders(
  options: ComposeResourceBackedViewProvidersOptions = {},
): AssetResourceBackedViewProvider {
  return createAssetResourceBackedViewAggregateProvider([
    options.artifactBrowserMetadataRead
      ? createArtifactResourceBackedViewProvider({
        artifactBrowserMetadataRead: options.artifactBrowserMetadataRead,
      })
      : unsupportedFamilyProvider("asset-artifact-resource-backed-view-provider", "artifact"),
    options.imageAssetDescriptorRead || options.generatedImageOutputDescriptorSource
      ? createAssetImageResourceBackedViewProvider({
        imageAssetDescriptorRead: options.imageAssetDescriptorRead,
        generatedImageOutputDescriptorSource: options.generatedImageOutputDescriptorSource,
      })
      : unsupportedFamilyProvider("asset-image-resource-backed-view-provider", "image-generated-output"),
    options.datasetDescriptorSource || options.modelRegistry
      ? createAssetDatasetModelResourceBackedViewProvider({
        datasetDescriptorSource: options.datasetDescriptorSource,
        modelRegistry: options.modelRegistry,
      })
      : unsupportedFamilyProvider("asset-dataset-model-resource-backed-view-provider", "dataset-model"),
    options.externalRepositoryObjectDescriptorSource ||
      options.artifactRepoObjectDescriptorSource ||
      options.artifactStorageBindingSource ||
      options.publishedModelRegistry
      ? createAssetExternalRepositoryResourceBackedViewProvider({
        externalRepositoryObjectDescriptorSource: options.externalRepositoryObjectDescriptorSource,
        artifactRepoObjectDescriptorSource: options.artifactRepoObjectDescriptorSource,
        artifactStorageBindingSource: options.artifactStorageBindingSource,
        publishedModelRegistry: options.publishedModelRegistry,
      })
      : unsupportedFamilyProvider("asset-external-repository-resource-backed-view-provider", "external-repository-object"),
  ]);
}

function unsupportedFamilyProvider(providerId: string, sourceKind: string): AssetResourceBackedViewProvider {
  return createUnsupportedAssetResourceBackedViewProvider({
    providerId: `${providerId}-not-wired`,
    sourceKind,
    message: "Resource-backed views for this family are not wired because no safe descriptor read seam is available.",
  });
}
