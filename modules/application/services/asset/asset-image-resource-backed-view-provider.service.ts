import type {
  AssetFamily,
  AssetGeneratedOutputReference,
  AssetMetadata,
  AssetReference,
  AssetResourceBackedView,
  AssetResourceBackedViewKind,
  AssetResourceBacking,
  AssetType,
} from "../../../contracts/asset";
import { normalizeAssetId } from "../../../contracts/asset";
import type { ImageAsset } from "../../../contracts/image";
import type { ImageGenerationOutput } from "../../../contracts/image-generation";
import { isWorkspaceId } from "../../../contracts/workspace";
import type { ImageAssetDescriptorListResult, ImageAssetDescriptorReadPort, ImageResourceIdentityKind, ImageResourceIdentityPort } from "../../ports/image";
import { isImageResourcePublicId } from "../../ports/image";
import { captureAssetPackFingerprintInput } from "../asset-packs/asset-pack-fingerprint-input";
import type {
  AssetResourceBackedViewListQuery,
  AssetResourceBackedViewListResult,
  AssetResourceBackedViewProvider,
  AssetResourceBackedViewProviderDiagnostic,
} from "../../ports/asset";
import { AssetResourceBackedMappingService, assetResourceBackedMappingService } from "./asset-resource-backed-mapping.service";
import { BUILT_IN_ASSET_DEFINITION_VERSION } from "./built-ins";
import { isUnsafeAssetMetadataKey, isUnsafeAssetMetadataString, sanitizeAssetMetadata, sanitizeAssetStringValue, sanitizeAssetViewValue } from "./asset-safe-metadata";

export interface GeneratedImageOutputDescriptor {
  readonly outputId: string;
  readonly output?: ImageGenerationOutput;
  readonly generatedOutput?: AssetGeneratedOutputReference;
  readonly displayName?: string;
  readonly producedAt?: string;
  readonly artifactId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface GeneratedImageOutputDescriptorListResult {
  readonly items: readonly GeneratedImageOutputDescriptor[];
  readonly nextCursor?: string;
}

// Provider-local descriptor-only input seam. It is intentionally not a public
// Asset Kernel port; host composition may inject it later without broadening the
// application provider contract.
export interface GeneratedImageOutputDescriptorSource {
  listGeneratedImageOutputDescriptors(query: { readonly workspaceId: string; readonly searchText?: string; readonly limit?: number; readonly cursor?: string }): Promise<GeneratedImageOutputDescriptorListResult>;
  readGeneratedImageOutputDescriptor?(workspaceId: string, outputId: string): Promise<GeneratedImageOutputDescriptor | null | undefined>;
}

export interface AssetImageResourceBackedViewProviderDependencies {
  readonly imageResourceIdentity?: ImageResourceIdentityPort;
  readonly imageAssetDescriptorRead?: ImageAssetDescriptorReadPort;
  readonly generatedImageOutputDescriptorSource?: GeneratedImageOutputDescriptorSource;
  readonly mappingService?: AssetResourceBackedMappingService;
  readonly providerId?: string;
  readonly maxListLimit?: number;
}

const DEFAULT_PROVIDER_ID = "asset-image-resource-backed-view-provider";
const DEFAULT_LIST_LIMIT = 100;
const ABSOLUTE_MAX_LIST_LIMIT = 250;
const IMAGE_VIEW_ID_PREFIX = "asset-view.image.opaque.";
const GENERATED_OUTPUT_VIEW_ID_PREFIX = "asset-view.generated-output.opaque.";
type UnknownRecord = Readonly<Record<string, unknown>>;
type SourceListResult = Readonly<{ views: readonly AssetResourceBackedView[]; nextCursor?: string }>;

export class AssetImageResourceBackedViewProvider implements AssetResourceBackedViewProvider {
  public readonly providerId: string;
  private readonly imageAssetDescriptorRead?: ImageAssetDescriptorReadPort;
  private readonly generatedImageOutputDescriptorSource?: GeneratedImageOutputDescriptorSource;
  private readonly mappingService: AssetResourceBackedMappingService;
  private readonly maxListLimit: number;
  private readonly identities?: ImageResourceIdentityPort;

  public constructor(dependencies: AssetImageResourceBackedViewProviderDependencies = {}) {
    this.identities = dependencies.imageResourceIdentity;
    this.imageAssetDescriptorRead = dependencies.imageAssetDescriptorRead;
    this.generatedImageOutputDescriptorSource = dependencies.generatedImageOutputDescriptorSource;
    this.mappingService = dependencies.mappingService ?? assetResourceBackedMappingService;
    this.providerId = dependencies.providerId ?? DEFAULT_PROVIDER_ID;
    this.maxListLimit = Math.min(Math.max(1, dependencies.maxListLimit ?? DEFAULT_LIST_LIMIT), ABSOLUTE_MAX_LIST_LIMIT);
  }

  public async listResourceBackedViews(query: AssetResourceBackedViewListQuery = {}): Promise<AssetResourceBackedViewListResult> {
    if (!isWorkspaceId(query.workspaceId)) {
      return {
        items: [],
        diagnostics: [this.diagnostic("error", "image-resource-backed-view-workspace-required", "Workspace id is required for image and generated-output resource-backed views.")],
      };
    }
    if (!this.identities) return { items: [], diagnostics: [this.diagnostic("warning", "image-resource-backed-view-identities-unavailable", "Private image resource identities are unavailable.")] };
    const diagnostics: AssetResourceBackedViewProviderDiagnostic[] = [];
    const limit = this.safeLimit(query.limit);
    const imageSourceActive = allowsViewKind(query, "image-asset") && Boolean(this.imageAssetDescriptorRead);
    const generatedOutputSourceActive = allowsViewKind(query, "generated-output") && Boolean(this.generatedImageOutputDescriptorSource);
    const combinesSources = imageSourceActive && generatedOutputSourceActive;

    if (typeof query.limit === "number" && Number.isFinite(query.limit) && Math.floor(query.limit) > limit) {
      diagnostics.push(this.diagnostic("info", "image-resource-backed-view-limit-clamped", "Image resource-backed view limit was clamped.", {
        requestedLimit: query.limit,
        appliedLimit: limit,
      }));
    }

    if (query.cursor && combinesSources) {
      diagnostics.push(this.diagnostic("warning", "image-resource-backed-view-combined-cursor-unsupported", "Image resource-backed view cursor pagination is not returned when finalized image and generated-output sources are combined."));
    }

    if (query.lifecycleStatuses?.length) {
      diagnostics.push(this.diagnostic("info", "image-resource-backed-view-lifecycle-filter-unsupported", "Generated image output descriptors do not have Asset Kernel lifecycle status until finalization."));
    }

    const imageResult = await this.listImageAssetViews(query, limit, diagnostics, !combinesSources ? query.cursor : undefined);
    const remainingLimit = Math.max(0, limit - imageResult.views.length);
    const generatedOutputResult = remainingLimit > 0
      ? await this.listGeneratedOutputViews(query, remainingLimit, diagnostics, !combinesSources ? query.cursor : undefined)
      : { views: [] };

    const items = [...imageResult.views, ...generatedOutputResult.views]
      .filter((view) => matchesQuery(view, query))
      .slice(0, limit);
    const nextCursor = !combinesSources ? imageResult.nextCursor ?? generatedOutputResult.nextCursor : undefined;
    if (combinesSources && (imageResult.nextCursor || generatedOutputResult.nextCursor)) {
      diagnostics.push(this.diagnostic("info", "image-resource-backed-view-next-cursor-omitted", "Source cursors were omitted because combined finalized-image/generated-output pagination is not enabled."));
    }

    return sanitizeAssetViewValue({
      items,
      ...(nextCursor ? { nextCursor } : {}),
      ...(diagnostics.length ? { diagnostics } : {}),
    }) as AssetResourceBackedViewListResult;
  }

  public async readResourceBackedView(viewId: string, query: { readonly workspaceId?: string } = {}): Promise<AssetResourceBackedView | undefined> {
    if (!isWorkspaceId(query.workspaceId) || !this.identities || typeof viewId !== "string") return undefined;
    const kind = viewId.startsWith(IMAGE_VIEW_ID_PREFIX) ? "image"
      : viewId.startsWith(GENERATED_OUTPUT_VIEW_ID_PREFIX) ? "generated-output" : undefined;
    if (!kind) return undefined; // Legacy references require explicit owner-approved migration.
    const publicId = viewId.slice((kind === "image" ? IMAGE_VIEW_ID_PREFIX : GENERATED_OUTPUT_VIEW_ID_PREFIX).length);
    if (!isImageResourcePublicId(publicId)) return undefined;
    try {
      const mapping = await this.identities.resolveIdentity(query.workspaceId, publicId);
      if (!mapping || mapping.workspaceId !== query.workspaceId || mapping.kind !== kind || mapping.publicId !== publicId) return undefined;
      const diagnostics: AssetResourceBackedViewProviderDiagnostic[] = [];
      if (kind === "image" && this.imageAssetDescriptorRead?.readImageAssetDescriptor) {
        const descriptor = await this.imageAssetDescriptorRead.readImageAssetDescriptor(query.workspaceId, mapping.sourceId);
        if (!descriptor) return undefined;
        const captured = captureAssetPackFingerprintInput(descriptor) as unknown as ImageAsset;
        if (captured.assetId !== mapping.sourceId || captured.workspaceId !== query.workspaceId) return undefined;
        const view = await this.viewFromImageAsset(captured, diagnostics, query.workspaceId);
        return view?.viewId === viewId ? view : undefined;
      }
      if (kind === "generated-output" && this.generatedImageOutputDescriptorSource?.readGeneratedImageOutputDescriptor) {
        const descriptor = await this.generatedImageOutputDescriptorSource.readGeneratedImageOutputDescriptor(query.workspaceId, mapping.sourceId);
        if (!descriptor) return undefined;
        const captured = captureAssetPackFingerprintInput(descriptor) as unknown as GeneratedImageOutputDescriptor;
        if (captured.outputId !== mapping.sourceId) return undefined;
        const view = await this.viewFromGeneratedOutputDescriptor(captured, diagnostics, query.workspaceId);
        return view?.viewId === viewId ? view : undefined;
      }
    } catch { /* Source denial and private index failures expose no details. */ }
    return undefined;
  }

  private async listImageAssetViews(
    query: AssetResourceBackedViewListQuery,
    limit: number,
    diagnostics: AssetResourceBackedViewProviderDiagnostic[],
    cursor: string | undefined,
  ): Promise<SourceListResult> {
    if (limit <= 0 || !allowsViewKind(query, "image-asset")) return { views: [] };
    if (!this.imageAssetDescriptorRead) {
      diagnostics.push(this.diagnostic("warning", "image-resource-backed-view-image-source-unavailable", "Finalized image asset descriptor list seam is not available."));
      return { views: [] };
    }

    let items: readonly ImageAsset[];
    let nextCursor: string | undefined;
    try {
      const result = captureAssetPackFingerprintInput(await this.imageAssetDescriptorRead.listImageAssetDescriptors({
        workspaceId: query.workspaceId as never,
        searchText: query.searchText,
        limit,
        cursor: await this.sourceCursor(query.workspaceId!, "image-cursor", cursor),
      })) as unknown as ImageAssetDescriptorListResult;
      items = result.items;
      if (!Array.isArray(items)) throw new Error("Invalid image descriptors.");
      nextCursor = result.nextCursor ? await this.publicIdentity(query.workspaceId!, "image-cursor", result.nextCursor) : undefined;
    } catch {
      diagnostics.push(this.diagnostic("warning", "image-resource-backed-view-image-source-failed", "Finalized image asset descriptor source failed while listing resource-backed views.", {
        failureKind: "source-exception",
      }));
      return { views: [] };
    }

    const views: AssetResourceBackedView[] = [];
    for (const item of items) {
      let view: AssetResourceBackedView | undefined;
      try { view = await this.viewFromImageAsset(captureAssetPackFingerprintInput(item) as unknown as ImageAsset, diagnostics, query.workspaceId!); }
      catch { diagnostics.push(this.diagnostic("warning", "image-resource-backed-view-skipped-invalid-descriptor", "An image descriptor or its private identity was unavailable.")); }
      if (!view || !matchesQuery(view, query)) continue;
      views.push(view);
      if (views.length >= limit) break;
    }
    return { views, ...(nextCursor ? { nextCursor } : {}) };
  }

  private async listGeneratedOutputViews(
    query: AssetResourceBackedViewListQuery,
    limit: number,
    diagnostics: AssetResourceBackedViewProviderDiagnostic[],
    cursor: string | undefined,
  ): Promise<SourceListResult> {
    if (limit <= 0 || !allowsViewKind(query, "generated-output")) return { views: [] };
    if (!this.generatedImageOutputDescriptorSource) {
      diagnostics.push(this.diagnostic("info", "image-resource-backed-view-generated-output-source-unavailable", "Generated image output descriptor source is not available."));
      return { views: [] };
    }

    let items: readonly GeneratedImageOutputDescriptor[];
    let nextCursor: string | undefined;
    try {
      const result = captureAssetPackFingerprintInput(await this.generatedImageOutputDescriptorSource.listGeneratedImageOutputDescriptors({
        workspaceId: query.workspaceId as string,
        searchText: query.searchText,
        limit,
        cursor: await this.sourceCursor(query.workspaceId!, "output-cursor", cursor),
      })) as unknown as GeneratedImageOutputDescriptorListResult;
      items = result.items;
      if (!Array.isArray(items)) throw new Error("Invalid output descriptors.");
      nextCursor = result.nextCursor ? await this.publicIdentity(query.workspaceId!, "output-cursor", result.nextCursor) : undefined;
    } catch {
      diagnostics.push(this.diagnostic("warning", "image-resource-backed-view-generated-output-source-failed", "Generated image output descriptor source failed while listing resource-backed views.", {
        failureKind: "source-exception",
      }));
      return { views: [] };
    }

    const views: AssetResourceBackedView[] = [];
    for (const item of items) {
      let view: AssetResourceBackedView | undefined;
      try { view = await this.viewFromGeneratedOutputDescriptor(captureAssetPackFingerprintInput(item) as unknown as GeneratedImageOutputDescriptor, diagnostics, query.workspaceId!); }
      catch { diagnostics.push(this.diagnostic("warning", "image-resource-backed-view-skipped-invalid-descriptor", "An image descriptor or its private identity was unavailable.")); }
      if (!view || !matchesQuery(view, query)) continue;
      views.push(view);
      if (views.length >= limit) break;
    }
    return { views, ...(nextCursor ? { nextCursor } : {}) };
  }

  private async viewFromImageAsset(
    image: ImageAsset,
    diagnostics: AssetResourceBackedViewProviderDiagnostic[],
    workspaceId: string,
  ): Promise<AssetResourceBackedView | undefined> {
    if (image.workspaceId !== workspaceId) return undefined;
    const imageIdentity = await this.safeIdentity(workspaceId, "image", image.assetId, "Image asset");
    const artifactIdentity = await this.safeIdentity(workspaceId, "artifact", image.artifactId, "Image artifact");
    if (!imageIdentity || !artifactIdentity) {
      diagnostics.push(this.diagnostic("warning", "image-resource-backed-view-skipped-invalid-descriptor", "An image asset descriptor was skipped because its identifier was invalid."));
      return undefined;
    }

    if (hasUnsafeMetadata(image.metadata)) {
      diagnostics.push(this.diagnostic("warning", "image-resource-backed-view-unsafe-data-omitted", "Unsafe image asset metadata fields were omitted from a resource-backed view."));
    }

    const metadata = image.metadata as unknown as UnknownRecord;
    const displayName = safeDisplayName(stringField(metadata, ["title", "name", "displayName", "originalFileName"])) ?? imageIdentity.safeLabel;
    const sourceRef = artifactSourceRef(artifactIdentity, displayName);
    const backing: AssetResourceBacking = sanitizeAssetViewValue({
      backingId: `image.opaque.${imageIdentity.publicId}`,
      resourceKind: "image",
      ref: sourceRef,
      role: "primary",
      displayName,
      createdAt: safeMetadataString(image.metadata.createdAt),
      metadata: metadataOf({
        artifactId: artifactIdentity.publicId,
        imageAssetId: imageIdentity.publicId,
        source: image.source,
        ...safeImageGenerationMetadata(metadata),
      }),
    }) as AssetResourceBacking;
    const assetRef: AssetReference = {
      kind: "resource-backed-asset",
      id: normalizeAssetId(`image-asset.${imageIdentity.publicId}`),
      label: displayName,
      metadata: metadataOf({ imageAssetId: imageIdentity.publicId }),
    };

    return sanitizeAssetViewValue({
      viewId: `${IMAGE_VIEW_ID_PREFIX}${imageIdentity.publicId}`,
      viewKind: "image-asset",
      assetType: "image" satisfies AssetType,
      assetFamily: "resource-backed" satisfies AssetFamily,
      assetDefinitionRef: builtInDefinitionRef("builtin.resource-backed-image"),
      resourceBacking: backing,
      resourceBackedAsset: this.mappingService.mapBackingToResourceBackedAsset(assetRef, backing, "image"),
      sourceRef,
      displayName,
      summary: "Finalized image asset resource view; not a newly registered Asset Kernel instance.",
      lifecycleStatus: "published",
      metadata: metadataOf({
        workspaceId: image.workspaceId,
        imageAssetId: imageIdentity.publicId,
        artifactId: artifactIdentity.publicId,
        source: image.source,
        width: image.metadata.width,
        height: image.metadata.height,
        ...safeImageGenerationMetadata(metadata),
      }),
    }) as AssetResourceBackedView;
  }

  private async viewFromGeneratedOutputDescriptor(
    descriptor: GeneratedImageOutputDescriptor,
    diagnostics: AssetResourceBackedViewProviderDiagnostic[],
    workspaceId: string,
  ): Promise<AssetResourceBackedView | undefined> {
    const declaredWorkspace = descriptor.generatedOutput?.metadata?.workspaceId ?? descriptor.metadata?.workspaceId;
    if (declaredWorkspace !== undefined && declaredWorkspace !== workspaceId) return undefined;
    const outputIdentity = await this.safeIdentity(workspaceId, "generated-output", descriptor.outputId, "Generated image output");
    if (!outputIdentity) {
      diagnostics.push(this.diagnostic("warning", "image-resource-backed-view-skipped-invalid-descriptor", "A generated image output descriptor was skipped because its identifier was invalid."));
      return undefined;
    }

    if (hasUnsafeMetadata(descriptor) || hasUnsafeMetadata(descriptor.metadata)) {
      diagnostics.push(this.diagnostic("warning", "image-resource-backed-view-unsafe-data-omitted", "Unsafe generated image output descriptor fields were omitted from a resource-backed view."));
    }

    const artifactIdentity = descriptor.artifactId ? await this.safeIdentity(workspaceId, "artifact", descriptor.artifactId, "Image artifact") : undefined;
    const generatedOutput = this.generatedOutputReference(descriptor, outputIdentity, workspaceId, artifactIdentity);
    const backing = this.mappingService.mapGeneratedOutputToBacking(generatedOutput);
    const displayName =
      safeDisplayName(descriptor.displayName) ??
      safeDisplayName(descriptor.output?.fileName) ??
      outputIdentity.safeLabel;

    return sanitizeAssetViewValue({
      viewId: `${GENERATED_OUTPUT_VIEW_ID_PREFIX}${outputIdentity.publicId}`,
      viewKind: "generated-output",
      generatedOutput,
      resourceBacking: {
        ...backing,
        displayName,
        contentType: safeContentType(descriptor.output?.mediaType),
        metadata: metadataOf({
          producedAssetType: "image",
          runtimeCapabilityId: "image-generation",
          artifactId: artifactIdentity?.publicId,
        }),
      },
      displayName,
      summary: "Generated image output descriptor; not finalized or registered as an image asset.",
      metadata: metadataOf({
        workspaceId,
        outputId: outputIdentity.publicId,
        producedAssetType: "image",
        finalized: false,
        registered: false,
        mediaType: descriptor.output?.mediaType,
        width: descriptor.output?.width,
        height: descriptor.output?.height,
        engine: safeEngineValue(descriptor.output?.engine ?? stringField(descriptor.metadata, ["engine"])),
        model: safeModelValue(stringField(descriptor.metadata, ["model", "checkpoint"])),
        sampler: safeModelValue(stringField(descriptor.metadata, ["sampler"])),
        seed: numberField(descriptor.metadata, ["seed"]),
        ...safeImageGenerationMetadata(descriptor.metadata),
      }),
      diagnostics: [
        {
          severity: "info",
          code: "generated-output-not-finalized",
          message: "Generated image output is not finalized or registered as an image asset.",
          sourceKind: "image-generation-output",
          metadata: metadataOf({ producedAssetType: "image" }),
        },
      ],
    }) as AssetResourceBackedView;
  }

  private generatedOutputReference(
    descriptor: GeneratedImageOutputDescriptor,
    outputIdentity: SafeIdentity,
    workspaceId: string,
    artifactIdentity?: SafeIdentity,
  ): AssetGeneratedOutputReference {
    const base = descriptor.generatedOutput ?? (descriptor.output
      ? this.mappingService.mapImageGenerationOutputToGeneratedOutputReference(descriptor.output, outputIdentity.publicId)
      : {
          outputId: outputIdentity.publicId,
          runtimeCapabilityId: "image-generation" as const,
          producedAssetType: "image" as const,
        });
    const artifactRef = artifactIdentity ? artifactSourceRef(artifactIdentity, artifactIdentity.safeLabel) : undefined;

    return sanitizeAssetViewValue({
      outputId: outputIdentity.publicId,
      runtimeCapabilityId: "image-generation",
      producedAssetType: "image",
      producedAt: safeMetadataString(descriptor.producedAt ?? base.producedAt),
      ...(artifactRef ? { sourceRefs: [artifactRef] } : {}),
      metadata: metadataOf({
        workspaceId,
        ...safeImageGenerationMetadata(base.metadata),
        ...safeImageGenerationMetadata(descriptor.metadata),
        artifactId: artifactIdentity?.publicId,
      }),
    }) as AssetGeneratedOutputReference;
  }

  private async publicIdentity(workspaceId: string, kind: ImageResourceIdentityKind, sourceId: string): Promise<string> {
    if (!isWorkspaceId(workspaceId) || !this.identities) throw new Error("Private image identity unavailable.");
    const id = await this.identities.getOrCreateIdentity(workspaceId, kind, sourceId);
    if (!isImageResourcePublicId(id)) throw new Error("Private image identity unavailable.");
    return id;
  }

  private async safeIdentity(workspaceId: string, kind: ImageResourceIdentityKind, sourceId: string, safeLabel: string): Promise<SafeIdentity | undefined> {
    if (typeof sourceId !== "string" || !sourceId) return undefined;
    return { publicId: await this.publicIdentity(workspaceId, kind, sourceId), safeLabel };
  }

  private async sourceCursor(workspaceId: string, kind: ImageResourceIdentityKind, cursor: string | undefined): Promise<string | undefined> {
    if (!cursor) return undefined;
    if (!isWorkspaceId(workspaceId) || !this.identities || !isImageResourcePublicId(cursor)) throw new Error("Image cursor unavailable.");
    const mapping = await this.identities.resolveIdentity(workspaceId, cursor);
    if (!mapping || mapping.workspaceId !== workspaceId || mapping.kind !== kind || mapping.publicId !== cursor) throw new Error("Image cursor unavailable.");
    return mapping.sourceId;
  }

  private safeLimit(limit: number | undefined): number {
    if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) return this.maxListLimit;
    return Math.min(Math.floor(limit), this.maxListLimit);
  }

  private diagnostic(
    severity: AssetResourceBackedViewProviderDiagnostic["severity"],
    code: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): AssetResourceBackedViewProviderDiagnostic {
    return {
      severity,
      code,
      message,
      providerId: this.providerId,
      sourceKind: "image",
      ...(metadataOf(metadata) ? { metadata: metadataOf(metadata) } : {}),
    };
  }
}

export function createAssetImageResourceBackedViewProvider(
  dependencies: AssetImageResourceBackedViewProviderDependencies = {},
): AssetImageResourceBackedViewProvider {
  return new AssetImageResourceBackedViewProvider(dependencies);
}

interface SafeIdentity {
  readonly publicId: string;
  readonly safeLabel: string;
}

function artifactSourceRef(identity: SafeIdentity, label: string): AssetReference {
  return {
    kind: "artifact",
    id: normalizeAssetId(`artifact-ref.${identity.publicId}`),
    label,
    metadata: metadataOf({ artifactId: identity.publicId }),
  };
}

function builtInDefinitionRef(id: "builtin.resource-backed-image"): AssetReference {
  return {
    kind: "asset-definition",
    id: normalizeAssetId(id),
    version: BUILT_IN_ASSET_DEFINITION_VERSION,
  };
}

function metadataOf(value: Record<string, unknown> | AssetMetadata | undefined): AssetMetadata | undefined {
  return sanitizeAssetMetadata(value);
}

function safeImageGenerationMetadata(metadata: UnknownRecord | undefined): AssetMetadata | undefined {
  if (!metadata) return undefined;
  const safe: Record<string, unknown> = {};
  const engine = safeEngineValue(stringField(metadata, ["engine"]));
  const model = safeModelValue(stringField(metadata, ["model", "checkpoint"]));
  const sampler = safeModelValue(stringField(metadata, ["sampler"]));
  const seed = numberField(metadata, ["seed"]);
  if (engine) safe.engine = engine;
  if (model) safe.model = model;
  if (sampler) safe.sampler = sampler;
  if (typeof seed === "number") safe.seed = seed;
  return metadataOf(safe);
}

function unsafeImageMetadataKey(key: string): boolean {
  return isUnsafeAssetMetadataKey(key) || /^(prompt|negativePrompt|workflow|workflowJson|comfyui|fileName|subfolder|storageKey|thumbnail|preview|dataUrl|request|rawWorkflow)$/i.test(key);
}

function hasUnsafeMetadata(value: unknown): boolean {
  if (typeof value === "string") return isUnsafeAssetMetadataString(value);
  if (Array.isArray(value)) return value.some((entry) => hasUnsafeMetadata(entry));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value as Record<string, unknown>).some(([key, entry]) => unsafeImageMetadataKey(key) || hasUnsafeMetadata(entry));
  }
  return false;
}

function safeDisplayName(value: string | undefined): string | undefined {
  const sanitized = sanitizeAssetStringValue(value);
  if (!sanitized || /[\\/]/.test(sanitized) || /^[a-z]:/i.test(sanitized) || /^data:/i.test(sanitized)) return undefined;
  return sanitized;
}

function safeMetadataString(value: string | undefined): string | undefined {
  return sanitizeAssetStringValue(value);
}

function safeContentType(value: string | undefined): string | undefined {
  const sanitized = sanitizeAssetStringValue(value);
  if (!sanitized || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(sanitized)) return undefined;
  return sanitized.toLowerCase();
}

function safeEngineValue(value: string | undefined): string | undefined {
  const sanitized = sanitizeAssetStringValue(value);
  if (!sanitized || !/^[a-z0-9_.:-]{1,80}$/i.test(sanitized)) return undefined;
  return sanitized;
}

function safeModelValue(value: string | undefined): string | undefined {
  const sanitized = sanitizeAssetStringValue(value);
  if (!sanitized || /[\\/]/.test(sanitized) || /^[a-z]:/i.test(sanitized) || sanitized.length > 120) return undefined;
  return sanitized;
}

function stringField(metadata: UnknownRecord | undefined, keys: readonly string[]): string | undefined {
  if (!metadata) return undefined;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string") {
      const sanitized = sanitizeAssetStringValue(value);
      if (sanitized) return sanitized;
    }
  }
  return undefined;
}

function numberField(metadata: UnknownRecord | undefined, keys: readonly string[]): number | undefined {
  if (!metadata) return undefined;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function allowsViewKind(query: AssetResourceBackedViewListQuery, viewKind: AssetResourceBackedViewKind): boolean {
  return !query.viewKinds?.length || query.viewKinds.includes(viewKind);
}

function matchesQuery(view: AssetResourceBackedView, query: AssetResourceBackedViewListQuery): boolean {
  return (
    (!query.assetTypes?.length || (view.assetType !== undefined && query.assetTypes.includes(view.assetType))) &&
    (!query.assetFamilies?.length || (view.assetFamily !== undefined && query.assetFamilies.includes(view.assetFamily))) &&
    (!query.lifecycleStatuses?.length || (view.lifecycleStatus !== undefined && query.lifecycleStatuses.includes(view.lifecycleStatus))) &&
    (!query.viewKinds?.length || query.viewKinds.includes(view.viewKind)) &&
    matchesSearch(query.searchText, [
      view.viewId,
      view.viewKind,
      view.displayName,
      view.summary,
      view.assetType,
      view.assetFamily,
      view.generatedOutput?.outputId,
      view.resourceBacking?.contentType,
    ])
  );
}

function matchesSearch(searchText: string | undefined, values: readonly (string | undefined)[]): boolean {
  const needle = searchText?.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => value?.toLowerCase().includes(needle));
}

