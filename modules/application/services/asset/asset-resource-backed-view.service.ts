import type { ArtifactDescriptor, ArtifactReference } from "../../../contracts/artifact";
import type { DatasetDescriptor } from "../../../contracts/dataset";
import type { ImageAsset } from "../../../contracts/image";
import type { ImageGenerationOutput } from "../../../contracts/image-generation";
import type { ModelInventoryRecord } from "../../../contracts/model";
import type { ArtifactRepoDescriptor, ArtifactRepoTarget } from "../../../contracts/storage";
import { normalizeAssetId } from "../../../contracts/asset";
import type {
  AssetExternalRepositoryObjectReference,
  AssetGeneratedOutputReference,
  AssetLifecycleStatus,
  AssetMetadata,
  AssetReference,
  AssetResourceBackedView,
  AssetResourceBackedViewDiagnostic,
  AssetResourcePreviewKind,
  AssetResourcePreviewReference,
  AssetType,
} from "../../../contracts/asset";
import { BUILT_IN_ASSET_DEFINITION_VERSION, type BuiltInAssetDefinitionId } from "./built-ins";
import { AssetResourceBackedMappingService, assetResourceBackedMappingService } from "./asset-resource-backed-mapping.service";
import { sanitizeAssetJsonValue, sanitizeAssetMetadata, sanitizeAssetViewValue } from "./asset-safe-metadata";

type UnknownRecord = Readonly<Record<string, unknown>>;

interface ViewBuildOptions {
  readonly sourceKind: string;
  readonly metadata?: UnknownRecord;
}

interface PreviewViewInput {
  readonly previewId: string;
  readonly previewKind: AssetResourcePreviewKind;
  readonly assetRef?: AssetReference;
  readonly resourceBackingRef?: AssetReference;
  readonly contentType?: string;
  readonly summary?: string;
  readonly metadata?: UnknownRecord;
}

const DOCUMENT_MEDIA_TYPE_PATTERN = /^(application\/(pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document|rtf)|text\/(plain|markdown|csv|html))$/i;
const DOCUMENT_EXTENSION_PATTERN = /^(pdf|doc|docx|rtf|txt|md|markdown|csv|html|htm)$/i;

function trimText(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function stableToken(value: string): string {
  const token = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return token.length > 0 ? token : "resource";
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function internalId(prefix: string, seed: string | undefined): string {
  const safeSeed = trimText(seed) ?? prefix;
  return `${prefix}.internal.${stableHash(safeSeed)}`;
}

function typedAssetRef(kind: AssetReference["kind"], id: string, label?: string, metadata?: AssetMetadata): AssetReference {
  return {
    kind,
    id: normalizeAssetId(id),
    ...(label ? { label } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function builtInDefinitionRef(id: BuiltInAssetDefinitionId): AssetReference {
  return {
    kind: "asset-definition",
    id: normalizeAssetId(id),
    version: BUILT_IN_ASSET_DEFINITION_VERSION,
  };
}

function metadataOf(metadata: UnknownRecord | undefined): AssetMetadata | undefined {
  return sanitizeAssetMetadata(metadata);
}

function diagnostic(code: string, message: string, sourceKind: string, severity: AssetResourceBackedViewDiagnostic["severity"] = "info", metadata?: UnknownRecord): AssetResourceBackedViewDiagnostic {
  return {
    severity,
    code,
    message,
    sourceKind,
    ...(metadataOf(metadata) ? { metadata: metadataOf(metadata) } : {}),
  };
}

function inferDocumentLike(descriptor: ArtifactDescriptor): boolean | undefined {
  const mediaType = trimText(descriptor.format?.mediaType);
  if (mediaType && DOCUMENT_MEDIA_TYPE_PATTERN.test(mediaType)) return true;

  const extension = trimText(descriptor.format?.extension);
  if (extension && DOCUMENT_EXTENSION_PATTERN.test(extension)) return true;

  return undefined;
}

function lifecycleFromModelStatus(status: ModelInventoryRecord["lifecycleStatus"]): AssetLifecycleStatus {
  switch (status) {
    case "validated":
      return "validated";
    case "invalid":
      return "failed-validation";
    default:
      return "draft";
  }
}

function validationSummaryFromModel(record: ModelInventoryRecord): AssetResourceBackedView["validationSummary"] | undefined {
  if (!record.validationStatus) return undefined;
  const status = record.validationStatus === "valid" ? "valid" : record.validationStatus === "invalid" ? "invalid" : record.validationStatus === "warning" ? "valid-with-warnings" : "unknown";
  return { status, metadata: metadataOf({ modelValidationStatus: record.validationStatus }) };
}

function scrubView<T extends AssetResourceBackedView>(view: T): T {
  return sanitizeAssetViewValue(view);
}

export class AssetResourceBackedViewService {
  constructor(private readonly mappingService: AssetResourceBackedMappingService = assetResourceBackedMappingService) {}

  fromArtifactDescriptor(descriptor: ArtifactDescriptor): AssetResourceBackedView {
    const documentLike = inferDocumentLike(descriptor);
    if (documentLike) return this.fromDocumentArtifactDescriptor(descriptor);

    const backing = this.mappingService.mapArtifactDescriptorToBacking(descriptor);
    return scrubView({
      viewId: internalId("asset-view.artifact", descriptor.id ?? descriptor.key),
      viewKind: "artifact",
      assetType: "data-source",
      assetFamily: "resource-backed",
      assetDefinitionRef: builtInDefinitionRef("builtin.artifact"),
      resourceBacking: backing,
      resourceBackedAsset: this.mappingService.mapBackingToResourceBackedAsset(typedAssetRef("resource-backed-asset", `artifact.${stableToken(descriptor.id ?? descriptor.key)}`), backing, "data-source"),
      sourceRef: typedAssetRef("artifact", `artifact-ref.${stableToken(descriptor.id ?? descriptor.key)}`, trimText(descriptor.name)),
      displayName: trimText(descriptor.name),
      summary: "Artifact descriptor read-side view.",
      metadata: metadataOf({ artifactId: descriptor.id, artifactKind: descriptor.kind, mediaType: descriptor.format?.mediaType, extension: descriptor.format?.extension, sizeBytes: descriptor.sizeBytes, ...descriptor.metadata }),
      diagnostics: [diagnostic("artifact-not-assumed-document", "Artifact descriptor is not document-like enough to use the document built-in.", "artifact")],
    });
  }

  fromArtifactReference(reference: ArtifactReference): AssetResourceBackedView {
    const backing = this.mappingService.mapArtifactReferenceToBacking(reference);
    return scrubView({
      viewId: internalId("asset-view.artifact", reference.key),
      viewKind: "artifact",
      assetType: "data-source",
      assetFamily: "resource-backed",
      assetDefinitionRef: builtInDefinitionRef("builtin.artifact"),
      resourceBacking: backing,
      sourceRef: typedAssetRef("artifact", `artifact-ref.${stableToken(reference.key)}`, trimText(reference.label)),
      displayName: trimText(reference.label),
      summary: "Artifact reference read-side view.",
      diagnostics: [diagnostic("artifact-reference-only", "Artifact reference has no descriptor details to classify as a document.", "artifact-reference", "warning")],
    });
  }

  fromDocumentArtifactDescriptor(descriptor: ArtifactDescriptor): AssetResourceBackedView {
    const backing = this.mappingService.mapArtifactDescriptorToBacking(descriptor);
    return scrubView({
      viewId: internalId("asset-view.document", descriptor.id ?? descriptor.key),
      viewKind: "document",
      assetType: "document",
      assetFamily: "resource-backed",
      assetDefinitionRef: builtInDefinitionRef("builtin.document"),
      resourceBacking: backing,
      resourceBackedAsset: this.mappingService.mapBackingToResourceBackedAsset(typedAssetRef("resource-backed-asset", `document.${stableToken(descriptor.id ?? descriptor.key)}`), backing, "document"),
      sourceRef: typedAssetRef("artifact", `artifact-ref.${stableToken(descriptor.id ?? descriptor.key)}`, trimText(descriptor.name)),
      displayName: trimText(descriptor.name),
      summary: "Document-like artifact descriptor read-side view.",
      metadata: metadataOf({ artifactId: descriptor.id, mediaType: descriptor.format?.mediaType, extension: descriptor.format?.extension, sizeBytes: descriptor.sizeBytes }),
    });
  }

  fromImageAsset(image: ImageAsset): AssetResourceBackedView {
    const resourceBackedAsset = this.mappingService.mapImageAssetToResourceBackedAsset(image);
    const backing = resourceBackedAsset.backings[0];
    return scrubView({
      viewId: internalId("asset-view.image", image.assetId),
      viewKind: "image-asset",
      assetType: "image",
      assetFamily: "resource-backed",
      assetDefinitionRef: builtInDefinitionRef("builtin.resource-backed-image"),
      assetInstanceRef: resourceBackedAsset.assetRef,
      resourceBacking: backing,
      resourceBackedAsset,
      sourceRef: typedAssetRef("artifact", `image-artifact-ref.${stableToken(image.artifactId)}`),
      displayName: trimText(image.metadata.originalFileName) ?? image.assetId,
      summary: "Finalized image asset read-side view.",
      lifecycleStatus: "published",
      metadata: metadataOf({ imageAssetId: image.assetId, artifactId: image.artifactId, source: image.source, width: image.metadata.width, height: image.metadata.height, engine: image.metadata.engine, requestId: image.metadata.requestId }),
    });
  }

  fromGeneratedImageOutput(output: ImageGenerationOutput, outputId: string, taskRef?: AssetReference): AssetResourceBackedView {
    const generatedOutput = this.mappingService.mapImageGenerationOutputToGeneratedOutputReference(output, outputId, taskRef);
    const backing = this.mappingService.mapGeneratedOutputToBacking(generatedOutput);
    return scrubView({
      viewId: internalId("asset-view.generated-output", outputId),
      viewKind: "generated-output",
      generatedOutput,
      resourceBacking: backing,
      displayName: trimText(output.fileName) ?? outputId,
      summary: "Generated output descriptor; not a registered image asset until finalization.",
      metadata: metadataOf({ mediaType: output.mediaType, width: output.width, height: output.height, promptId: output.promptId, engine: output.engine }),
      diagnostics: [diagnostic("generated-output-not-finalized", "Generated image output is intentionally not mapped to the finalized image asset built-in until finalized or registered.", "image-generation-output", "info", { producedAssetType: "image" })],
    });
  }

  fromGeneratedOutputReference(reference: AssetGeneratedOutputReference): AssetResourceBackedView {
    const backing = this.mappingService.mapGeneratedOutputToBacking(reference);
    return scrubView({
      viewId: internalId("asset-view.generated-output", reference.outputId),
      viewKind: "generated-output",
      generatedOutput: reference,
      resourceBacking: backing,
      summary: "Generated output reference; not a registered asset until finalization.",
      metadata: metadataOf(reference.metadata),
      diagnostics: [diagnostic("generated-output-not-finalized", "Generated output remains a generated-output view until an existing source marks it registered.", "generated-output")],
    });
  }

  fromDatasetDescriptor(descriptor: DatasetDescriptor): AssetResourceBackedView {
    const backing = this.mappingService.mapDatasetDescriptorToBacking(descriptor);
    return scrubView({
      viewId: internalId("asset-view.dataset", descriptor.id),
      viewKind: "dataset",
      assetType: "dataset",
      assetFamily: "resource-backed",
      assetDefinitionRef: builtInDefinitionRef("builtin.dataset"),
      resourceBacking: backing,
      resourceBackedAsset: this.mappingService.mapBackingToResourceBackedAsset(typedAssetRef("resource-backed-asset", `dataset.${stableToken(descriptor.id)}`, trimText(descriptor.name)), backing, "dataset"),
      displayName: trimText(descriptor.name) ?? descriptor.id,
      summary: "Dataset descriptor read-side view.",
      metadata: metadataOf({ datasetId: descriptor.id, sourceArtifactCount: descriptor.sourceArtifacts?.length, transformCount: descriptor.transforms?.length, materializationCount: descriptor.materializations?.length, schema: descriptor.schema, ...descriptor.metadata }),
    });
  }

  fromModelInventoryRecord(record: ModelInventoryRecord): AssetResourceBackedView {
    const backing = this.mappingService.mapModelInventoryRecordToBacking(record);
    return scrubView({
      viewId: internalId("asset-view.model", record.modelRecordId),
      viewKind: "model",
      assetType: "model",
      assetFamily: "resource-backed",
      assetDefinitionRef: builtInDefinitionRef("builtin.model"),
      resourceBacking: backing,
      resourceBackedAsset: this.mappingService.mapBackingToResourceBackedAsset(typedAssetRef("resource-backed-asset", `model.${stableToken(record.modelRecordId)}`, trimText(record.displayName)), backing, "model"),
      displayName: trimText(record.displayName),
      summary: "Model inventory record read-side view.",
      lifecycleStatus: lifecycleFromModelStatus(record.lifecycleStatus),
      validationSummary: validationSummaryFromModel(record),
      metadata: metadataOf({ modelRecordId: record.modelRecordId, modelId: record.modelId, source: record.source, provider: record.provider, taskTags: record.taskTags, artifactForm: record.artifactForm, inferenceMode: record.inferenceMode, serializationFormat: record.serializationFormat, parameterCount: record.parameterCount, sizeBytes: record.sizeBytes, baseModelId: record.baseModelId, generatedFromRunId: record.generatedFromRunId, adapterOfModelId: record.adapterOfModelId, backingArtifactIds: record.backingArtifactIds, primaryArtifactId: record.primaryArtifactId, validationStatus: record.validationStatus, published: record.published, ...record.metadata }),
    });
  }

  fromExternalRepositoryObject(reference: AssetExternalRepositoryObjectReference): AssetResourceBackedView {
    const backing = this.mappingService.mapExternalRepositoryObjectToBacking(reference);
    return scrubView({
      viewId: internalId("asset-view.external-repository-object", backing.backingId),
      viewKind: "external-repository-object",
      resourceBacking: backing,
      sourceRef: typedAssetRef("external-repository-object", backing.backingId),
      displayName: `${reference.provider} repository object`,
      summary: "External repository object view; not a registered asset by default.",
      metadata: metadataOf({ provider: reference.provider, repositoryId: reference.repositoryId, revision: reference.revision, objectPath: reference.objectPath, objectKind: reference.objectKind, contentType: reference.contentType, ...reference.metadata }),
      diagnostics: [diagnostic("external-object-not-registered", "External repository object is not treated as a registered asset until imported or explicitly registered.", "external-repository-object")],
    });
  }

  fromArtifactRepoObject(descriptor: ArtifactRepoDescriptor): AssetResourceBackedView {
    const backing = this.mappingService.mapArtifactRepoDescriptorToBacking(descriptor);
    return scrubView({
      viewId: internalId("asset-view.external-repository-object", backing.backingId),
      viewKind: "external-repository-object",
      resourceBacking: backing,
      sourceRef: typedAssetRef("external-repository-object", backing.backingId),
      summary: "Artifact repository object view; not a registered asset by default.",
      metadata: metadataOf({ mediaType: descriptor.mediaType, sizeBytes: descriptor.sizeBytes, provider: descriptor.target.provider, repository: descriptor.target.repository, revision: descriptor.target.revision, objectPath: descriptor.target.path }),
      diagnostics: [diagnostic("external-object-not-registered", "Artifact repository object remains an external object until localized, imported, or registered.", "artifact-repo-object")],
    });
  }

  fromArtifactRepoTarget(target: ArtifactRepoTarget): AssetResourceBackedView {
    return this.fromExternalRepositoryObject(this.mappingService.mapArtifactRepoTargetToExternalRepositoryObject(target));
  }

  fromPreview(input: PreviewViewInput | AssetResourcePreviewReference): AssetResourceBackedView {
    const preview = "previewId" in input && "previewKind" in input && !Object.prototype.hasOwnProperty.call(input, "metadata")
      ? (input as AssetResourcePreviewReference)
      : this.mappingService.createPreviewReference(input as PreviewViewInput);
    return scrubView({
      viewId: internalId("asset-view.preview", preview.previewId),
      viewKind: "preview",
      preview,
      displayName: preview.previewId,
      summary: trimText(preview.summary) ?? "Preview reference view; not a standalone asset by default.",
      metadata: metadataOf({ previewKind: preview.previewKind, contentType: preview.contentType, ...preview.metadata }),
      diagnostics: [diagnostic("preview-not-standalone-asset", "Preview is represented as preview metadata only and is not an independent asset by default.", "preview")],
    });
  }

  unsupported(source: unknown, options: ViewBuildOptions): AssetResourceBackedView {
    return scrubView({
      viewId: internalId("asset-view.unsupported", JSON.stringify(sanitizeAssetJsonValue({ source }) ?? {})),
      viewKind: "artifact",
      summary: "Unsupported resource-backed source shape.",
      metadata: metadataOf(options.metadata),
      diagnostics: [diagnostic("unsupported-source-shape", "Source shape is not supported by the resource-backed view mapper.", options.sourceKind, "warning")],
    });
  }
}

export const assetResourceBackedViewService = new AssetResourceBackedViewService();
