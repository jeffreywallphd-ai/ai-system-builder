import type {
  ArtifactRepoDescriptor,
  ArtifactRepoTarget,
  ArtifactStorageBinding,
} from "../../../contracts/storage";
import { resolveArtifactRepoBackingTarget } from "../../../contracts/storage";
import type { ModelInventoryRecord } from "../../../contracts/model";
import type {
  AssetExternalRepositoryObjectKind,
  AssetExternalRepositoryObjectReference,
  AssetExternalRepositoryProvider,
  AssetFamily,
  AssetMetadata,
  AssetReference,
  AssetResourceBackedView,
  AssetResourceBackedViewKind,
  AssetResourceBacking,
  AssetType,
} from "../../../contracts/asset";
import { isAssetExternalRepositoryObjectKind, normalizeAssetId } from "../../../contracts/asset";
import type { ModelRegistryPort } from "../../ports/model";
import type {
  AssetResourceBackedViewListQuery,
  AssetResourceBackedViewListResult,
  AssetResourceBackedViewProvider,
  AssetResourceBackedViewProviderDiagnostic,
} from "../../ports/asset";
import { AssetResourceBackedMappingService, assetResourceBackedMappingService } from "./asset-resource-backed-mapping.service";
import { isUnsafeAssetMetadataKey, isUnsafeAssetMetadataString, sanitizeAssetMetadata, sanitizeAssetStringValue, sanitizeAssetViewValue } from "./asset-safe-metadata";

export interface SafeExternalRepositoryObjectDescriptor {
  readonly descriptorId?: string;
  readonly provider: string;
  readonly repositoryId?: string;
  readonly repository?: string;
  readonly revision?: string;
  readonly objectPath?: string;
  readonly objectName?: string;
  readonly objectKind?: string;
  readonly contentType?: string;
  readonly sizeBytes?: number;
  readonly checksum?: string | { readonly algorithm?: string; readonly value?: string };
  readonly published?: boolean;
  readonly imported?: boolean;
  readonly localized?: boolean;
  readonly registered?: boolean;
  readonly publishedAt?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SafeExternalRepositoryObjectDescriptorListResult {
  readonly items: readonly SafeExternalRepositoryObjectDescriptor[];
  readonly nextCursor?: string;
}

// Provider-local descriptor-only input seams. These labels and descriptor
// sources do not grant provider-client, network, token, filesystem, import,
// localization, publishing, or existence-check authority.
export interface SafeExternalRepositoryObjectDescriptorSource {
  listExternalRepositoryObjectDescriptors(
    query?: { readonly searchText?: string; readonly limit?: number; readonly cursor?: string },
  ): Promise<SafeExternalRepositoryObjectDescriptorListResult>;
  readExternalRepositoryObjectDescriptor?(
    descriptorId: string,
  ): Promise<SafeExternalRepositoryObjectDescriptor | null | undefined>;
}

export interface SafeArtifactRepoObjectDescriptor {
  readonly descriptorId?: string;
  readonly descriptor: ArtifactRepoDescriptor;
  readonly displayName?: string;
  readonly objectKind?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SafeArtifactRepoObjectDescriptorListResult {
  readonly items: readonly SafeArtifactRepoObjectDescriptor[];
  readonly nextCursor?: string;
}

export interface SafeArtifactRepoObjectDescriptorSource {
  listArtifactRepoObjectDescriptors(
    query?: { readonly searchText?: string; readonly limit?: number; readonly cursor?: string },
  ): Promise<SafeArtifactRepoObjectDescriptorListResult>;
  readArtifactRepoObjectDescriptor?(descriptorId: string): Promise<SafeArtifactRepoObjectDescriptor | null | undefined>;
}

export interface SafeArtifactStorageBindingSource {
  listArtifactStorageBindings(
    query?: { readonly limit?: number; readonly cursor?: string },
  ): Promise<{ readonly bindings: readonly ArtifactStorageBinding[]; readonly nextCursor?: string }>;
}

export interface AssetExternalRepositoryResourceBackedViewProviderDependencies {
  readonly externalRepositoryObjectDescriptorSource?: SafeExternalRepositoryObjectDescriptorSource;
  readonly artifactRepoObjectDescriptorSource?: SafeArtifactRepoObjectDescriptorSource;
  readonly artifactStorageBindingSource?: SafeArtifactStorageBindingSource;
  readonly publishedModelRegistry?: Pick<ModelRegistryPort, "listModels" | "getModelRecord">;
  readonly mappingService?: AssetResourceBackedMappingService;
  readonly providerId?: string;
  readonly maxListLimit?: number;
}

const DEFAULT_PROVIDER_ID = "asset-external-repository-resource-backed-view-provider";
const DEFAULT_LIST_LIMIT = 100;
const ABSOLUTE_MAX_LIST_LIMIT = 250;
const VIEW_ID_PREFIX = "asset-view.external-repository-object.internal.";
type UnknownRecord = Readonly<Record<string, unknown>>;
type SourceListResult = Readonly<{ views: readonly AssetResourceBackedView[]; nextCursor?: string }>;

export class AssetExternalRepositoryResourceBackedViewProvider implements AssetResourceBackedViewProvider {
  public readonly providerId: string;
  private readonly externalRepositoryObjectDescriptorSource?: SafeExternalRepositoryObjectDescriptorSource;
  private readonly artifactRepoObjectDescriptorSource?: SafeArtifactRepoObjectDescriptorSource;
  private readonly artifactStorageBindingSource?: SafeArtifactStorageBindingSource;
  private readonly publishedModelRegistry?: Pick<ModelRegistryPort, "listModels" | "getModelRecord">;
  private readonly mappingService: AssetResourceBackedMappingService;
  private readonly maxListLimit: number;

  public constructor(dependencies: AssetExternalRepositoryResourceBackedViewProviderDependencies = {}) {
    this.externalRepositoryObjectDescriptorSource = dependencies.externalRepositoryObjectDescriptorSource;
    this.artifactRepoObjectDescriptorSource = dependencies.artifactRepoObjectDescriptorSource;
    this.artifactStorageBindingSource = dependencies.artifactStorageBindingSource;
    this.publishedModelRegistry = dependencies.publishedModelRegistry;
    this.mappingService = dependencies.mappingService ?? assetResourceBackedMappingService;
    this.providerId = dependencies.providerId ?? DEFAULT_PROVIDER_ID;
    this.maxListLimit = Math.min(Math.max(1, dependencies.maxListLimit ?? DEFAULT_LIST_LIMIT), ABSOLUTE_MAX_LIST_LIMIT);
  }

  public async listResourceBackedViews(query: AssetResourceBackedViewListQuery = {}): Promise<AssetResourceBackedViewListResult> {
    const diagnostics: AssetResourceBackedViewProviderDiagnostic[] = [];
    const limit = this.safeLimit(query.limit);
    const active = allowsViewKind(query, "external-repository-object") && allowsAssetFamily(query) && allowsExternalAssetType(query);

    if (typeof query.limit === "number" && Number.isFinite(query.limit) && Math.floor(query.limit) > limit) {
      diagnostics.push(this.diagnostic("info", "external-repository-resource-backed-view-limit-clamped", "External repository resource-backed view limit was clamped.", {
        requestedLimit: query.limit,
        appliedLimit: limit,
      }));
    }

    if (!active || limit <= 0) {
      return sanitizeAssetViewValue({
        items: [],
        ...(diagnostics.length ? { diagnostics } : {}),
      }) as AssetResourceBackedViewListResult;
    }

    const activeSourceCount = [
      this.externalRepositoryObjectDescriptorSource,
      this.artifactRepoObjectDescriptorSource,
      this.artifactStorageBindingSource,
      this.publishedModelRegistry,
    ].filter(Boolean).length;

    if (activeSourceCount === 0) {
      return {
        items: [],
        diagnostics: [
          ...diagnostics,
          this.diagnostic("info", "external-repository-resource-backed-view-source-unavailable", "Safe external repository object descriptor sources are not wired; external repository views are deferred until a descriptor source is injected."),
        ],
      };
    }

    if (query.cursor && activeSourceCount > 1) {
      diagnostics.push(this.diagnostic("warning", "external-repository-resource-backed-view-combined-cursor-unsupported", "External repository object cursor pagination is not returned when multiple metadata sources are combined."));
    }
    if (query.lifecycleStatuses?.length) {
      diagnostics.push(this.diagnostic("info", "external-repository-resource-backed-view-lifecycle-filter-unsupported", "External repository object descriptors are not registered Asset Kernel records and do not expose Asset Kernel lifecycle status through this provider."));
    }

    const sourceCursor = activeSourceCount === 1 ? query.cursor : undefined;
    const externalResult = await this.listExternalDescriptorViews(query, limit, diagnostics, sourceCursor);
    const remainingAfterExternal = Math.max(0, limit - externalResult.views.length);
    const artifactRepoResult = remainingAfterExternal > 0
      ? await this.listArtifactRepoViews(query, remainingAfterExternal, diagnostics, sourceCursor)
      : { views: [] };
    const remainingAfterArtifactRepo = Math.max(0, limit - externalResult.views.length - artifactRepoResult.views.length);
    const storageBindingResult = remainingAfterArtifactRepo > 0
      ? await this.listStorageBindingViews(query, remainingAfterArtifactRepo, diagnostics, sourceCursor)
      : { views: [] };
    const remainingAfterBindings = Math.max(0, limit - externalResult.views.length - artifactRepoResult.views.length - storageBindingResult.views.length);
    const modelPublishResult = remainingAfterBindings > 0
      ? await this.listPublishedModelViews(query, remainingAfterBindings, diagnostics, sourceCursor)
      : { views: [] };

    const items = [
      ...externalResult.views,
      ...artifactRepoResult.views,
      ...storageBindingResult.views,
      ...modelPublishResult.views,
    ].filter((view) => matchesQuery(view, query)).slice(0, limit);
    const nextCursor = activeSourceCount === 1
      ? externalResult.nextCursor ?? artifactRepoResult.nextCursor ?? storageBindingResult.nextCursor ?? modelPublishResult.nextCursor
      : undefined;
    if (activeSourceCount > 1 && (externalResult.nextCursor || artifactRepoResult.nextCursor || storageBindingResult.nextCursor || modelPublishResult.nextCursor)) {
      diagnostics.push(this.diagnostic("info", "external-repository-resource-backed-view-next-cursor-omitted", "Source cursors were omitted because combined external repository object pagination is not enabled."));
    }

    return sanitizeAssetViewValue({
      items,
      ...(nextCursor ? { nextCursor } : {}),
      ...(diagnostics.length ? { diagnostics } : {}),
    }) as AssetResourceBackedViewListResult;
  }

  public async readResourceBackedView(viewId: string, query: { readonly workspaceId?: string } = {}): Promise<AssetResourceBackedView | undefined> {
    const descriptorId = parseDirectViewId(viewId);
    if (descriptorId && this.externalRepositoryObjectDescriptorSource?.readExternalRepositoryObjectDescriptor) {
      try {
        const descriptor = await this.externalRepositoryObjectDescriptorSource.readExternalRepositoryObjectDescriptor(descriptorId);
        if (descriptor) {
          const diagnostics: AssetResourceBackedViewProviderDiagnostic[] = [];
          const view = this.viewFromExternalDescriptor(descriptor, diagnostics);
          if (view?.viewId === viewId) return view;
        }
      } catch {
        // Fall back to bounded list without exposing source errors.
      }
    }
    if (descriptorId && this.artifactRepoObjectDescriptorSource?.readArtifactRepoObjectDescriptor) {
      try {
        const descriptor = await this.artifactRepoObjectDescriptorSource.readArtifactRepoObjectDescriptor(descriptorId);
        if (descriptor) {
          const diagnostics: AssetResourceBackedViewProviderDiagnostic[] = [];
          const view = this.viewFromArtifactRepoDescriptor(descriptor, diagnostics);
          if (view?.viewId === viewId) return view;
        }
      } catch {
        // Fall back to bounded list without exposing source errors.
      }
    }
    if (descriptorId && this.publishedModelRegistry?.getModelRecord) {
      try {
        const record = await this.publishedModelRegistry.getModelRecord(query.workspaceId as never, descriptorId);
        if (record) {
          const diagnostics: AssetResourceBackedViewProviderDiagnostic[] = [];
          const view = this.viewFromPublishedModelRecord(record, diagnostics);
          if (view?.viewId === viewId) return view;
        }
      } catch {
        // Fall back to bounded list without exposing source errors.
      }
    }

    const result = await this.listResourceBackedViews({ limit: this.maxListLimit });
    const view = result.items.find((item) => item.viewId === viewId);
    return view ? withDetailFallbackDiagnostic(view, this.diagnostic("info", "external-repository-resource-backed-view-detail-list-fallback-limited", "Detail read used the bounded descriptor list fallback because a direct safe read seam or reversible safe view id was not available.")) : undefined;
  }

  private async listExternalDescriptorViews(
    query: AssetResourceBackedViewListQuery,
    limit: number,
    diagnostics: AssetResourceBackedViewProviderDiagnostic[],
    cursor: string | undefined,
  ): Promise<SourceListResult> {
    if (limit <= 0 || !this.externalRepositoryObjectDescriptorSource) return { views: [] };

    let items: readonly SafeExternalRepositoryObjectDescriptor[];
    let nextCursor: string | undefined;
    try {
      const result = await this.externalRepositoryObjectDescriptorSource.listExternalRepositoryObjectDescriptors({
        searchText: query.searchText,
        limit,
        cursor,
      });
      items = result.items;
      nextCursor = sanitizeAssetStringValue(result.nextCursor);
    } catch {
      diagnostics.push(this.diagnostic("warning", "external-repository-resource-backed-view-source-failed", "External repository object descriptor source failed while listing resource-backed views.", {
        failureKind: "source-exception",
      }));
      return { views: [] };
    }

    const views: AssetResourceBackedView[] = [];
    for (const item of items) {
      const view = this.viewFromExternalDescriptor(item, diagnostics);
      if (!view || !matchesQuery(view, query)) continue;
      views.push(view);
      if (views.length >= limit) break;
    }
    return { views, ...(nextCursor ? { nextCursor } : {}) };
  }

  private async listArtifactRepoViews(
    query: AssetResourceBackedViewListQuery,
    limit: number,
    diagnostics: AssetResourceBackedViewProviderDiagnostic[],
    cursor: string | undefined,
  ): Promise<SourceListResult> {
    if (limit <= 0 || !this.artifactRepoObjectDescriptorSource) return { views: [] };

    let items: readonly SafeArtifactRepoObjectDescriptor[];
    let nextCursor: string | undefined;
    try {
      const result = await this.artifactRepoObjectDescriptorSource.listArtifactRepoObjectDescriptors({
        searchText: query.searchText,
        limit,
        cursor,
      });
      items = result.items;
      nextCursor = sanitizeAssetStringValue(result.nextCursor);
    } catch {
      diagnostics.push(this.diagnostic("warning", "external-repository-resource-backed-view-artifact-repo-source-failed", "Artifact repository descriptor source failed while listing resource-backed views.", {
        failureKind: "source-exception",
      }));
      return { views: [] };
    }

    const views: AssetResourceBackedView[] = [];
    for (const item of items) {
      const view = this.viewFromArtifactRepoDescriptor(item, diagnostics);
      if (!view || !matchesQuery(view, query)) continue;
      views.push(view);
      if (views.length >= limit) break;
    }
    return { views, ...(nextCursor ? { nextCursor } : {}) };
  }

  private async listStorageBindingViews(
    query: AssetResourceBackedViewListQuery,
    limit: number,
    diagnostics: AssetResourceBackedViewProviderDiagnostic[],
    cursor: string | undefined,
  ): Promise<SourceListResult> {
    if (limit <= 0 || !this.artifactStorageBindingSource) return { views: [] };

    let bindings: readonly ArtifactStorageBinding[];
    let nextCursor: string | undefined;
    try {
      const result = await this.artifactStorageBindingSource.listArtifactStorageBindings({ limit, cursor });
      bindings = result.bindings;
      nextCursor = sanitizeAssetStringValue(result.nextCursor);
    } catch {
      diagnostics.push(this.diagnostic("warning", "external-repository-resource-backed-view-storage-binding-source-failed", "Artifact storage binding source failed while listing external repository object views.", {
        failureKind: "source-exception",
      }));
      return { views: [] };
    }

    const views: AssetResourceBackedView[] = [];
    for (const binding of bindings) {
      const view = this.viewFromStorageBinding(binding, diagnostics);
      if (!view || !matchesQuery(view, query)) continue;
      views.push(view);
      if (views.length >= limit) break;
    }
    return { views, ...(nextCursor ? { nextCursor } : {}) };
  }

  private async listPublishedModelViews(
    query: AssetResourceBackedViewListQuery,
    limit: number,
    diagnostics: AssetResourceBackedViewProviderDiagnostic[],
    cursor: string | undefined,
  ): Promise<SourceListResult> {
    if (limit <= 0 || !this.publishedModelRegistry) return { views: [] };

    let records: readonly ModelInventoryRecord[];
    let nextCursor: string | undefined;
    try {
      const result = await this.publishedModelRegistry.listModels({
        workspaceId: query.workspaceId as never,
        search: query.searchText,
        limit,
        cursor,
        includeDiscovered: false,
      });
      records = result.models;
      nextCursor = sanitizeAssetStringValue(result.nextCursor);
    } catch {
      diagnostics.push(this.diagnostic("warning", "external-repository-resource-backed-view-published-model-source-failed", "Persisted model publishing metadata source failed while listing external repository object views.", {
        failureKind: "source-exception",
      }));
      return { views: [] };
    }

    const views: AssetResourceBackedView[] = [];
    for (const record of records) {
      const view = this.viewFromPublishedModelRecord(record, diagnostics);
      if (!view || !matchesQuery(view, query)) continue;
      views.push(view);
      if (views.length >= limit) break;
    }
    return { views, ...(nextCursor ? { nextCursor } : {}) };
  }

  private viewFromExternalDescriptor(
    descriptor: SafeExternalRepositoryObjectDescriptor,
    diagnostics: AssetResourceBackedViewProviderDiagnostic[],
  ): AssetResourceBackedView | undefined {
    if (hasUnsafeExternalData(descriptor) || hasUnsafeExternalData(descriptor.metadata)) {
      diagnostics.push(this.diagnostic("warning", "external-repository-resource-backed-view-unsafe-data-omitted", "Unsafe external repository object descriptor fields were omitted from a resource-backed view."));
    }

    const repositoryId = safeRepositoryId(descriptor.repositoryId ?? descriptor.repository);
    const provider = safeProvider(descriptor.provider);
    if (!provider || !repositoryId) {
      diagnostics.push(this.diagnostic("warning", "external-repository-resource-backed-view-skipped-invalid-descriptor", "An external repository object descriptor was skipped because provider or repository metadata was invalid."));
      return undefined;
    }

    const objectKind = safeObjectKind(descriptor.objectKind) ?? (safeObjectPath(descriptor.objectPath) ? "file" : "repository");
    const objectPath = safeObjectPath(descriptor.objectPath);
    if (descriptor.objectPath && !objectPath) {
      diagnostics.push(this.diagnostic("warning", "external-repository-resource-backed-view-object-path-omitted", "An unsafe external repository object path was omitted."));
    }
    if (objectKind !== "repository" && !objectPath && !safeDisplayName(descriptor.objectName)) {
      diagnostics.push(this.diagnostic("warning", "external-repository-resource-backed-view-skipped-invalid-descriptor", "An external repository object descriptor was skipped because it did not include a safe object identifier."));
      return undefined;
    }

    const reference = externalReference({
      provider,
      repositoryId,
      revision: safeRevision(descriptor.revision),
      objectPath,
      objectKind,
      contentType: safeContentType(descriptor.contentType),
      metadata: metadataOf({
        descriptorId: safeIdentifier(descriptor.descriptorId),
        published: descriptor.published === true ? true : undefined,
        imported: descriptor.imported === true ? true : undefined,
        localized: descriptor.localized === true ? true : undefined,
        registered: descriptor.registered === true ? true : false,
        publishedAt: safeTimestamp(descriptor.publishedAt),
        ...safePublicMetadata(descriptor.metadata),
      }),
    });
    const displayName = safeDisplayName(descriptor.objectName) ?? safePathBasename(objectPath) ?? repositoryId;
    return this.viewFromReference(reference, {
      rawIdentity: descriptor.descriptorId ?? identitySeed(reference),
      directId: descriptor.descriptorId,
      displayName,
      contentType: safeContentType(descriptor.contentType),
      sizeBytes: safeNonNegativeNumber(descriptor.sizeBytes),
      checksum: checksumValue(descriptor.checksum),
      metadata: metadataOf({
        descriptorId: safeIdentifier(descriptor.descriptorId),
        provider,
        repositoryId,
        revision: safeRevision(descriptor.revision),
        objectKind,
        objectName: displayName,
        contentType: safeContentType(descriptor.contentType),
        sizeBytes: safeNonNegativeNumber(descriptor.sizeBytes),
        checksum: checksumValue(descriptor.checksum),
        published: descriptor.published === true ? true : undefined,
        imported: descriptor.imported === true ? true : undefined,
        localized: descriptor.localized === true ? true : undefined,
        registered: descriptor.registered === true ? true : false,
        publishedAt: safeTimestamp(descriptor.publishedAt),
        ...safePublicMetadata(descriptor.metadata),
      }),
      sourceKind: "external-repository-object",
    });
  }

  private viewFromArtifactRepoDescriptor(
    item: SafeArtifactRepoObjectDescriptor,
    diagnostics: AssetResourceBackedViewProviderDiagnostic[],
  ): AssetResourceBackedView | undefined {
    const target = safeArtifactRepoTarget(item.descriptor.target);
    if (!target) {
      diagnostics.push(this.diagnostic("warning", "external-repository-resource-backed-view-skipped-invalid-artifact-repo-descriptor", "An artifact repository descriptor was skipped because target metadata was unsafe or invalid."));
      return undefined;
    }
    if (hasUnsafeExternalData(item) || hasUnsafeExternalData(item.metadata)) {
      diagnostics.push(this.diagnostic("warning", "external-repository-resource-backed-view-unsafe-data-omitted", "Unsafe artifact repository descriptor fields were omitted from a resource-backed view."));
    }

    const descriptor: SafeExternalRepositoryObjectDescriptor = {
      descriptorId: item.descriptorId,
      provider: target.provider,
      repositoryId: target.repository,
      revision: target.revision,
      objectPath: target.path,
      objectName: item.displayName,
      objectKind: item.objectKind ?? "artifact",
      contentType: item.descriptor.mediaType,
      sizeBytes: item.descriptor.sizeBytes,
      checksum: item.descriptor.checksum,
      metadata: {
        sourceDescriptorKind: "artifact-repo",
        ...item.metadata,
      },
    };
    const view = this.viewFromExternalDescriptor(descriptor, diagnostics);
    return view ? withSourceKind(view, "artifact-repo-object") : undefined;
  }

  private viewFromStorageBinding(
    binding: ArtifactStorageBinding,
    diagnostics: AssetResourceBackedViewProviderDiagnostic[],
  ): AssetResourceBackedView | undefined {
    if (binding.backing.kind !== "artifact-repo") return undefined;
    const target = resolveArtifactRepoBackingTarget(binding.backing);
    if (!target) {
      diagnostics.push(this.diagnostic("warning", "external-repository-resource-backed-view-skipped-invalid-storage-binding", "An artifact storage binding was skipped because external repository target metadata was unavailable."));
      return undefined;
    }
    const safeTarget = safeArtifactRepoTarget({
      provider: target.provider,
      repository: target.repository,
      revision: target.revision,
      path: target.path,
    });
    if (!safeTarget) {
      diagnostics.push(this.diagnostic("warning", "external-repository-resource-backed-view-skipped-invalid-storage-binding", "An artifact storage binding was skipped because external repository target metadata was unsafe."));
      return undefined;
    }
    const view = this.viewFromExternalDescriptor({
      descriptorId: `${safeTarget.provider}.${stableHash(`${safeTarget.repository}\u001f${safeTarget.revision ?? ""}\u001f${safeTarget.path ?? ""}\u001f${binding.role}`)}`,
      provider: safeTarget.provider,
      repositoryId: safeTarget.repository,
      revision: safeTarget.revision,
      objectPath: safeTarget.path,
      objectKind: "artifact",
      published: binding.role === "published" ? binding.backing.verification?.exists === true : undefined,
      imported: binding.role === "imported-source" ? true : undefined,
      localized: false,
      registered: false,
      metadata: {
        sourceDescriptorKind: "artifact-storage-binding",
        bindingRole: binding.role,
        linkedArtifactId: safeIdentifier(binding.artifactId),
        verified: binding.backing.verification?.exists,
        verifiedAt: safeTimestamp(binding.backing.verification?.verifiedAt),
        createdAt: safeTimestamp(binding.createdAt),
      },
    }, diagnostics);
    return view ? withSourceKind(view, "artifact-storage-binding") : undefined;
  }

  private viewFromPublishedModelRecord(
    record: ModelInventoryRecord,
    diagnostics: AssetResourceBackedViewProviderDiagnostic[],
  ): AssetResourceBackedView | undefined {
    if (!record.published) return undefined;
    if (hasUnsafeExternalData(record.published) || hasUnsafeExternalData(record.metadata)) {
      diagnostics.push(this.diagnostic("warning", "external-repository-resource-backed-view-unsafe-data-omitted", "Unsafe persisted model publishing metadata fields were omitted from an external repository object view."));
    }
    const repositoryId = safeRepositoryId(record.published.repository);
    if (!repositoryId) {
      diagnostics.push(this.diagnostic("warning", "external-repository-resource-backed-view-skipped-invalid-published-model", "Persisted model publishing metadata was skipped because repository metadata was unsafe or invalid."));
      return undefined;
    }
    const objectName = safeDisplayName(record.displayName) ?? safeDisplayName(record.modelId) ?? safeIdentifier(record.modelRecordId);
    const view = this.viewFromExternalDescriptor({
      descriptorId: record.modelRecordId,
      provider: record.published.provider,
      repositoryId,
      revision: record.published.revision,
      objectName,
      objectKind: "model",
      published: true,
      registered: false,
      metadata: {
        sourceDescriptorKind: "published-model-metadata",
        modelRecordId: safeIdentifier(record.modelRecordId),
        modelId: safeModelId(record.modelId),
        publishedAt: safeTimestamp(record.published.publishedAt),
      },
    }, diagnostics);
    return view ? withSourceKind(view, "published-model-metadata") : undefined;
  }

  private viewFromReference(
    reference: AssetExternalRepositoryObjectReference,
    input: {
      readonly rawIdentity: string;
      readonly directId?: string;
      readonly displayName: string;
      readonly contentType?: string;
      readonly sizeBytes?: number;
      readonly checksum?: string;
      readonly metadata?: AssetMetadata;
      readonly sourceKind: string;
    },
  ): AssetResourceBackedView | undefined {
    const backing = this.mappingService.mapExternalRepositoryObjectToBacking(reference);
    const safeBacking: AssetResourceBacking = sanitizeAssetViewValue({
      ...backing,
      displayName: input.displayName,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      checksum: input.checksum,
      metadata: metadataOf({
        provider: reference.provider,
        repositoryId: reference.repositoryId,
        revision: reference.revision,
        objectKind: reference.objectKind,
        objectName: input.displayName,
        sizeBytes: input.sizeBytes,
        checksum: input.checksum,
        ...input.metadata,
      }),
    }) as AssetResourceBacking;
    const viewId = `${VIEW_ID_PREFIX}${safeDirectId(input.directId) ?? stableHash(identitySeed(reference) || input.rawIdentity)}`;
    const sourceRef: AssetReference = {
      kind: "external-repository-object",
      id: normalizeAssetId(`external-repository-object.${stableHash(identitySeed(reference) || input.rawIdentity)}`),
      label: input.displayName,
      metadata: metadataOf({
        provider: reference.provider,
        repositoryId: reference.repositoryId,
        revision: reference.revision,
        objectKind: reference.objectKind,
      }),
    };

    return sanitizeAssetViewValue({
      viewId,
      viewKind: "external-repository-object",
      assetFamily: "resource-backed" satisfies AssetFamily,
      assetType: assetTypeForObjectKind(reference.objectKind),
      resourceBacking: safeBacking,
      sourceRef,
      displayName: input.displayName,
      summary: "External repository object known from sanitized metadata; not imported, localized, or registered as an Asset Kernel asset instance.",
      metadata: metadataOf({
        provider: reference.provider,
        repositoryId: reference.repositoryId,
        revision: reference.revision,
        objectKind: reference.objectKind,
        objectName: input.displayName,
        imported: false,
        localized: false,
        registered: false,
        ...input.metadata,
      }),
      diagnostics: [
        {
          severity: "info",
          code: "external-object-not-registered",
          message: "External repository object is metadata-only and is not imported, localized, or registered as an asset.",
          sourceKind: input.sourceKind,
          metadata: metadataOf({ provider: reference.provider, objectKind: reference.objectKind }),
        },
      ],
    }) as AssetResourceBackedView;
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
      sourceKind: "external-repository-object",
      ...(metadataOf(metadata) ? { metadata: metadataOf(metadata) } : {}),
    };
  }
}

export function createAssetExternalRepositoryResourceBackedViewProvider(
  dependencies: AssetExternalRepositoryResourceBackedViewProviderDependencies = {},
): AssetExternalRepositoryResourceBackedViewProvider {
  return new AssetExternalRepositoryResourceBackedViewProvider(dependencies);
}

function externalReference(input: AssetExternalRepositoryObjectReference): AssetExternalRepositoryObjectReference {
  return {
    provider: input.provider,
    repositoryId: input.repositoryId,
    revision: input.revision,
    objectPath: input.objectPath,
    objectKind: input.objectKind,
    contentType: input.contentType,
    metadata: input.metadata,
  };
}

function metadataOf(value: Record<string, unknown> | AssetMetadata | undefined): AssetMetadata | undefined {
  return sanitizeAssetMetadata(value);
}

function safeProvider(value: string | undefined): AssetExternalRepositoryProvider | undefined {
  const sanitized = sanitizeAssetStringValue(value)?.toLowerCase();
  if (!sanitized || looksLocalPathLike(sanitized) || looksUrlLike(sanitized)) return undefined;
  switch (sanitized) {
    case "huggingface":
    case "hf":
      return "huggingface";
    case "local":
    case "local-filesystem":
      return "local";
    case "github":
      return "github";
    case "http":
    case "https":
      return "http";
    case "artifact-repo":
    case "artifact_repository":
      return "custom";
    default:
      return /^[a-z0-9_.:-]{1,80}$/i.test(sanitized) ? "custom" : undefined;
  }
}

function safeObjectKind(value: string | undefined): AssetExternalRepositoryObjectKind | undefined {
  const sanitized = sanitizeAssetStringValue(value)?.toLowerCase();
  if (!sanitized) return undefined;
  return isAssetExternalRepositoryObjectKind(sanitized) ? sanitized : "custom";
}

function safeArtifactRepoTarget(target: ArtifactRepoTarget | undefined): ArtifactRepoTarget | undefined {
  if (!target) return undefined;
  const provider = sanitizeAssetStringValue(target.provider);
  const repository = safeRepositoryId(target.repository);
  const revision = safeRevision(target.revision);
  const path = safeObjectPath(target.path);
  if (!provider || !repository || (target.path && !path) || !safeProvider(provider)) return undefined;
  return {
    provider,
    repository,
    ...(revision ? { revision } : {}),
    ...(path ? { path } : {}),
  };
}

function safeRepositoryId(value: string | undefined): string | undefined {
  const sanitized = sanitizeAssetStringValue(value);
  if (!sanitized || looksUrlLike(sanitized) || looksLocalPathLike(sanitized) || /[?#]/.test(sanitized) || sanitized.length > 200) return undefined;
  if (!/^[a-z0-9][a-z0-9_.-]*(\/[a-z0-9][a-z0-9_.-]*){0,2}$/i.test(sanitized)) return undefined;
  return sanitized;
}

function safeRevision(value: string | undefined): string | undefined {
  const sanitized = sanitizeAssetStringValue(value);
  if (!sanitized || looksUrlLike(sanitized) || looksLocalPathLike(sanitized) || /[?#]/.test(sanitized) || sanitized.length > 160) return undefined;
  return /^[a-z0-9][a-z0-9._/-]*$/i.test(sanitized) ? sanitized : undefined;
}

function safeObjectPath(value: string | undefined): string | undefined {
  const sanitized = sanitizeAssetStringValue(value);
  if (!sanitized || looksUrlLike(sanitized) || looksLocalPathLike(sanitized) || sanitized.startsWith("/") || sanitized.startsWith("\\") || /[?#]/.test(sanitized) || sanitized.length > 500) return undefined;
  if (sanitized.split("/").some((segment) => segment === "." || segment === ".." || segment.trim().length === 0)) return undefined;
  if (!/^[a-z0-9][a-z0-9._/@+= -]*(\/[a-z0-9][a-z0-9._/@+= -]*)*$/i.test(sanitized)) return undefined;
  return sanitized;
}

function safePathBasename(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const segments = value.split("/").filter(Boolean);
  return safeDisplayName(segments[segments.length - 1]);
}

function safeDisplayName(value: string | undefined): string | undefined {
  const sanitized = sanitizeAssetStringValue(value);
  if (!sanitized || looksLocalPathLike(sanitized) || looksUrlLike(sanitized) || sanitized.length > 160) return undefined;
  return sanitized.replace(/[\\/]+/g, " ").trim() || undefined;
}

function safeContentType(value: string | undefined): string | undefined {
  const sanitized = sanitizeAssetStringValue(value);
  if (!sanitized || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(sanitized)) return undefined;
  return sanitized.toLowerCase();
}

function safeTimestamp(value: string | undefined): string | undefined {
  const sanitized = sanitizeAssetStringValue(value);
  if (!sanitized || looksLocalPathLike(sanitized) || looksUrlLike(sanitized)) return undefined;
  return sanitized;
}

function safeIdentifier(value: string | undefined): string | undefined {
  const sanitized = sanitizeAssetStringValue(value);
  if (!sanitized || looksLocalPathLike(sanitized) || looksUrlLike(sanitized) || sanitized.length > 160) return undefined;
  return stableToken(sanitized);
}

function safeDirectId(value: string | undefined): string | undefined {
  const token = safeIdentifier(value);
  return token && value?.trim() === token ? token : undefined;
}

function safeModelId(value: string | undefined): string | undefined {
  const sanitized = sanitizeAssetStringValue(value);
  if (!sanitized || looksLocalPathLike(sanitized) || looksUrlLike(sanitized) || sanitized.length > 160) return undefined;
  return sanitized;
}

function safeNonNegativeNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function checksumValue(checksum: SafeExternalRepositoryObjectDescriptor["checksum"]): string | undefined {
  if (typeof checksum === "string") return safeIdentifier(checksum);
  if (!checksum?.value) return undefined;
  const value = safeIdentifier(checksum.value);
  const algorithm = safeIdentifier(checksum.algorithm);
  if (!value) return undefined;
  return algorithm ? `${algorithm}:${value}` : value;
}

function safePublicMetadata(metadata: UnknownRecord | undefined): AssetMetadata | undefined {
  if (!metadata) return undefined;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (isExternalUnsafeMetadataKey(key)) continue;
    const sanitized = sanitizeSafePublicValue(value);
    if (typeof sanitized !== "undefined") safe[key] = sanitized;
  }
  return metadataOf(safe);
}

function sanitizeSafePublicValue(value: unknown): unknown {
  if (typeof value === "string") {
    const sanitized = sanitizeAssetStringValue(value);
    if (!sanitized || looksLocalPathLike(sanitized) || looksUrlWithQueryOrAuth(sanitized)) return undefined;
    return sanitized;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    const entries = value.map(sanitizeSafePublicValue).filter((entry) => typeof entry !== "undefined");
    return entries.length ? entries : undefined;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !isExternalUnsafeMetadataKey(key))
      .map(([key, entry]) => [key, sanitizeSafePublicValue(entry)] as const)
      .filter((entry): entry is readonly [string, unknown] => typeof entry[1] !== "undefined");
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return undefined;
}

function hasUnsafeExternalData(value: unknown): boolean {
  if (typeof value === "string") return isUnsafeAssetMetadataString(value) || looksLocalPathLike(value) || looksUrlWithQueryOrAuth(value);
  if (Array.isArray(value)) return value.some((entry) => hasUnsafeExternalData(entry));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value as Record<string, unknown>).some(([key, entry]) => isExternalUnsafeMetadataKey(key) || hasUnsafeExternalData(entry));
  }
  return false;
}

function isExternalUnsafeMetadataKey(key: string): boolean {
  return isUnsafeAssetMetadataKey(key) || /^(url|downloadUrl|signedUrl|authorization|authHeader|accessToken|apiKey|password|secret|env|rawPayload|providerPayload|localPath|cachePath|storageRoot|runtimeRoot|commandLine|stackTrace|objectContents?|content|bytes|blob|base64|hfCache|huggingFaceCache)$/i.test(key);
}

function looksLocalPathLike(value: string): boolean {
  const trimmed = value.trim();
  return (
    /^[a-z]:[\\/]/i.test(trimmed) ||
    /^\\\\/.test(trimmed) ||
    /^~[\\/]/.test(trimmed) ||
    /^\.\.?[\\/]/.test(trimmed) ||
    /^\/(?:tmp|temp|var|home|users|etc|private|opt|usr|mnt|volumes|data|cache)(?:\/|$)/i.test(trimmed) ||
    /[\\/](?:users|temp|tmp|cache|huggingface|\.cache|checkpoints?|models?|datasets?|outputs?|reports?)[\\/]/i.test(trimmed)
  );
}

function looksUrlLike(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim());
}

function looksUrlWithQueryOrAuth(value: string): boolean {
  const trimmed = value.trim();
  if (!looksUrlLike(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return Boolean(parsed.username || parsed.password || parsed.search || parsed.hash);
  } catch {
    return true;
  }
}

function assetTypeForObjectKind(kind: AssetExternalRepositoryObjectKind | undefined): AssetType | undefined {
  switch (kind) {
    case "model":
      return "model";
    case "dataset":
      return "dataset";
    case "file":
    case "artifact":
      return "data-source";
    case "preview":
      return "data-source";
    default:
      return undefined;
  }
}

function allowsViewKind(query: AssetResourceBackedViewListQuery, viewKind: AssetResourceBackedViewKind): boolean {
  return !query.viewKinds?.length || query.viewKinds.includes(viewKind);
}

function allowsAssetFamily(query: AssetResourceBackedViewListQuery): boolean {
  return !query.assetFamilies?.length || query.assetFamilies.includes("resource-backed");
}

function allowsExternalAssetType(query: AssetResourceBackedViewListQuery): boolean {
  if (!query.assetTypes?.length) return true;
  return query.assetTypes.some((assetType) => assetType === "model" || assetType === "dataset" || assetType === "data-source");
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
      stringMetadata(view.metadata, "provider"),
      stringMetadata(view.metadata, "repositoryId"),
      stringMetadata(view.metadata, "objectKind"),
      stringMetadata(view.metadata, "objectName"),
      view.resourceBacking?.displayName,
    ])
  );
}

function matchesSearch(searchText: string | undefined, values: readonly (string | undefined)[]): boolean {
  const needle = searchText?.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => value?.toLowerCase().includes(needle));
}

function stringMetadata(metadata: AssetMetadata | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function identitySeed(reference: AssetExternalRepositoryObjectReference): string {
  return [
    reference.provider,
    reference.repositoryId,
    reference.revision ?? "",
    reference.objectKind ?? "",
    reference.objectPath ?? "",
  ].join("\u001f");
}

function stableToken(value: string): string {
  const token = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return token.length > 0 ? token : "external-object";
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function parseDirectViewId(viewId: string): string | undefined {
  if (!viewId.startsWith(VIEW_ID_PREFIX)) return undefined;
  const candidate = viewId.slice(VIEW_ID_PREFIX.length);
  if (!candidate || !/^[a-z0-9_.-]+$/i.test(candidate)) return undefined;
  return candidate;
}

function withSourceKind(view: AssetResourceBackedView, sourceKind: string): AssetResourceBackedView {
  return sanitizeAssetViewValue({
    ...view,
    diagnostics: view.diagnostics?.map((diagnostic) => ({ ...diagnostic, sourceKind })),
    metadata: metadataOf({ ...view.metadata, sourceDescriptorKind: sourceKind }),
  }) as AssetResourceBackedView;
}

function withDetailFallbackDiagnostic(
  view: AssetResourceBackedView,
  diagnostic: AssetResourceBackedViewProviderDiagnostic,
): AssetResourceBackedView {
  return sanitizeAssetViewValue({
    ...view,
    diagnostics: [...(view.diagnostics ?? []), {
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      sourceKind: diagnostic.sourceKind,
      metadata: diagnostic.metadata,
    }],
  }) as AssetResourceBackedView;
}
