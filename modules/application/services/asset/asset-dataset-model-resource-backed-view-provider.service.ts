import type {
  DatasetDescriptor,
  DatasetMaterializationDescriptor,
  DatasetSchemaSummary,
} from "../../../contracts/dataset";
import { isWorkspaceId } from "../../../contracts/workspace";
import type { ModelInventoryRecord } from "../../../contracts/model";
import type {
  AssetFamily,
  AssetLifecycleStatus,
  AssetMetadata,
  AssetReference,
  AssetResourceBackedView,
  AssetResourceBackedViewKind,
  AssetResourceBacking,
  AssetType,
} from "../../../contracts/asset";
import { normalizeAssetId } from "../../../contracts/asset";
import type { ModelRegistryPort } from "../../ports/model";
import type {
  AssetResourceBackedViewListQuery,
  AssetResourceBackedViewListResult,
  AssetResourceBackedViewProvider,
  AssetResourceBackedViewProviderDiagnostic,
} from "../../ports/asset";
import { AssetResourceBackedMappingService, assetResourceBackedMappingService } from "./asset-resource-backed-mapping.service";
import { BUILT_IN_ASSET_DEFINITION_VERSION } from "./built-ins";
import { isUnsafeAssetMetadataKey, isUnsafeAssetMetadataString, sanitizeAssetMetadata, sanitizeAssetStringValue, sanitizeAssetViewValue } from "./asset-safe-metadata";

export interface SafeDatasetDescriptorListResult {
  readonly items: readonly DatasetDescriptor[];
  readonly nextCursor?: string;
}

// Provider-local descriptor-only input seam. It remains narrow by design and is
// not a public Asset Kernel port unless a later host-wiring prompt proves reuse.
export interface SafeDatasetDescriptorSource {
  listDatasetDescriptors(query: { readonly workspaceId: string; readonly searchText?: string; readonly limit?: number; readonly cursor?: string }): Promise<SafeDatasetDescriptorListResult>;
  readDatasetDescriptor?(workspaceId: string, datasetId: string): Promise<DatasetDescriptor | null | undefined>;
}

export interface AssetDatasetModelResourceBackedViewProviderDependencies {
  readonly datasetDescriptorSource?: SafeDatasetDescriptorSource;
  readonly modelRegistry?: Pick<ModelRegistryPort, "listModels" | "getModelRecord">;
  readonly mappingService?: AssetResourceBackedMappingService;
  readonly providerId?: string;
  readonly maxListLimit?: number;
}

const DEFAULT_PROVIDER_ID = "asset-dataset-model-resource-backed-view-provider";
const DEFAULT_LIST_LIMIT = 100;
const ABSOLUTE_MAX_LIST_LIMIT = 250;
const DATASET_VIEW_ID_PREFIX = "asset-view.dataset.internal.";
const MODEL_VIEW_ID_PREFIX = "asset-view.model.internal.";
type UnknownRecord = Readonly<Record<string, unknown>>;
type SourceListResult = Readonly<{ views: readonly AssetResourceBackedView[]; nextCursor?: string }>;

export class AssetDatasetModelResourceBackedViewProvider implements AssetResourceBackedViewProvider {
  public readonly providerId: string;
  private readonly datasetDescriptorSource?: SafeDatasetDescriptorSource;
  private readonly modelRegistry?: Pick<ModelRegistryPort, "listModels" | "getModelRecord">;
  private readonly mappingService: AssetResourceBackedMappingService;
  private readonly maxListLimit: number;

  public constructor(dependencies: AssetDatasetModelResourceBackedViewProviderDependencies = {}) {
    this.datasetDescriptorSource = dependencies.datasetDescriptorSource;
    this.modelRegistry = dependencies.modelRegistry;
    this.mappingService = dependencies.mappingService ?? assetResourceBackedMappingService;
    this.providerId = dependencies.providerId ?? DEFAULT_PROVIDER_ID;
    this.maxListLimit = Math.min(Math.max(1, dependencies.maxListLimit ?? DEFAULT_LIST_LIMIT), ABSOLUTE_MAX_LIST_LIMIT);
  }

  public async listResourceBackedViews(query: AssetResourceBackedViewListQuery = {}): Promise<AssetResourceBackedViewListResult> {
    if (!isWorkspaceId(query.workspaceId)) {
      return { items: [], diagnostics: [this.diagnostic("error", "dataset-model-resource-backed-view-workspace-required", "Workspace id is required for dataset/model resource-backed views.")] };
    }
    const diagnostics: AssetResourceBackedViewProviderDiagnostic[] = [];
    const limit = this.safeLimit(query.limit);
    const datasetActive = allowsViewKind(query, "dataset") && allowsAssetType(query, "dataset") && allowsAssetFamily(query);
    const modelActive = allowsViewKind(query, "model") && allowsAssetType(query, "model") && allowsAssetFamily(query);
    const combinesSources = datasetActive && modelActive;

    if (typeof query.limit === "number" && Number.isFinite(query.limit) && Math.floor(query.limit) > limit) {
      diagnostics.push(this.diagnostic("info", "dataset-model-resource-backed-view-limit-clamped", "Dataset/model resource-backed view limit was clamped.", {
        requestedLimit: query.limit,
        appliedLimit: limit,
      }));
    }

    if (query.cursor && combinesSources) {
      diagnostics.push(this.diagnostic("warning", "dataset-model-resource-backed-view-combined-cursor-unsupported", "Dataset/model resource-backed view cursor pagination is not returned when dataset and model sources are combined."));
    }

    if (query.lifecycleStatuses?.length && datasetActive) {
      diagnostics.push(this.diagnostic("info", "dataset-resource-backed-view-lifecycle-filter-unsupported", "Dataset descriptors do not expose Asset Kernel lifecycle status through this provider."));
    }

    const sourceCursor = !combinesSources ? query.cursor : undefined;
    const datasetResult = await this.listDatasetViews(query, limit, diagnostics, sourceCursor);
    const remainingLimit = Math.max(0, limit - datasetResult.views.length);
    const modelResult = remainingLimit > 0
      ? await this.listModelViews(query, remainingLimit, diagnostics, sourceCursor)
      : { views: [] };

    const items = [...datasetResult.views, ...modelResult.views]
      .filter((view) => matchesQuery(view, query))
      .slice(0, limit);
    const nextCursor = !combinesSources ? datasetResult.nextCursor ?? modelResult.nextCursor : undefined;
    if (combinesSources && (datasetResult.nextCursor || modelResult.nextCursor)) {
      diagnostics.push(this.diagnostic("info", "dataset-model-resource-backed-view-next-cursor-omitted", "Source cursors were omitted because combined dataset/model pagination is not enabled."));
    }

    return sanitizeAssetViewValue({
      items,
      ...(nextCursor ? { nextCursor } : {}),
      ...(diagnostics.length ? { diagnostics } : {}),
    }) as AssetResourceBackedViewListResult;
  }

  public async readResourceBackedView(viewId: string, query: { readonly workspaceId?: string } = {}): Promise<AssetResourceBackedView | undefined> {
    if (!isWorkspaceId(query.workspaceId)) return undefined;
    const datasetId = parseDirectViewId(viewId, DATASET_VIEW_ID_PREFIX);
    if (datasetId && this.datasetDescriptorSource?.readDatasetDescriptor) {
      try {
        const descriptor = await this.datasetDescriptorSource.readDatasetDescriptor(query.workspaceId, datasetId);
        if (descriptor) {
          const diagnostics: AssetResourceBackedViewProviderDiagnostic[] = [];
          const view = this.viewFromDatasetDescriptor(descriptor, diagnostics);
          if (view?.viewId === viewId) return view;
        }
      } catch {
        // Fall through to the bounded list path without exposing source details.
      }
    }

    const modelRecordId = parseDirectViewId(viewId, MODEL_VIEW_ID_PREFIX);
    if (modelRecordId && this.modelRegistry?.getModelRecord) {
      try {
        const record = await this.modelRegistry.getModelRecord(query.workspaceId, modelRecordId);
        if (record) {
          const diagnostics: AssetResourceBackedViewProviderDiagnostic[] = [];
          const view = this.viewFromModelInventoryRecord(record, diagnostics);
          if (view?.viewId === viewId) return view;
        }
      } catch {
        // Fall through to the bounded list path without exposing source details.
      }
    }

    const result = await this.listResourceBackedViews({ limit: this.maxListLimit, workspaceId: query.workspaceId });
    const view = result.items.find((item) => item.viewId === viewId);
    return view ? withDetailFallbackDiagnostic(view, this.diagnostic("info", "dataset-model-resource-backed-view-detail-list-fallback-limited", "Detail read used the bounded descriptor list fallback because a direct safe read seam or reversible safe view id was not available.")) : undefined;
  }

  private async listDatasetViews(
    query: AssetResourceBackedViewListQuery,
    limit: number,
    diagnostics: AssetResourceBackedViewProviderDiagnostic[],
    cursor: string | undefined,
  ): Promise<SourceListResult> {
    if (limit <= 0 || !allowsViewKind(query, "dataset") || !allowsAssetType(query, "dataset") || !allowsAssetFamily(query)) return { views: [] };
    if (!this.datasetDescriptorSource) {
      diagnostics.push(this.diagnostic("info", "dataset-resource-backed-view-source-unavailable", "Dataset descriptor list seam is not available; dataset resource-backed views are deferred until a safe descriptor source is injected."));
      return { views: [] };
    }

    let items: readonly DatasetDescriptor[];
    let nextCursor: string | undefined;
    try {
      const result = await this.datasetDescriptorSource.listDatasetDescriptors({
        workspaceId: query.workspaceId as string,
        searchText: query.searchText,
        limit,
        cursor,
      });
      items = result.items;
      nextCursor = sanitizeAssetStringValue(result.nextCursor);
    } catch {
      diagnostics.push(this.diagnostic("warning", "dataset-resource-backed-view-source-failed", "Dataset descriptor source failed while listing resource-backed views.", {
        failureKind: "source-exception",
      }));
      return { views: [] };
    }

    const views: AssetResourceBackedView[] = [];
    for (const item of items) {
      const view = this.viewFromDatasetDescriptor(item, diagnostics);
      if (!view || !matchesQuery(view, query)) continue;
      views.push(view);
      if (views.length >= limit) break;
    }
    return { views, ...(nextCursor ? { nextCursor } : {}) };
  }

  private async listModelViews(
    query: AssetResourceBackedViewListQuery,
    limit: number,
    diagnostics: AssetResourceBackedViewProviderDiagnostic[],
    cursor: string | undefined,
  ): Promise<SourceListResult> {
    if (limit <= 0 || !allowsViewKind(query, "model") || !allowsAssetType(query, "model") || !allowsAssetFamily(query)) return { views: [] };
    diagnostics.push(this.diagnostic("info", "model-resource-backed-view-discovery-disabled", "Model resource-backed views list persisted inventory only; local discovery is disabled."));
    if (!this.modelRegistry) {
      diagnostics.push(this.diagnostic("warning", "model-resource-backed-view-source-unavailable", "Model inventory list seam is not available."));
      return { views: [] };
    }

    let records: readonly ModelInventoryRecord[];
    let nextCursor: string | undefined;
    try {
      const result = await this.modelRegistry.listModels({
        workspaceId: query.workspaceId as never,
        search: query.searchText,
        limit,
        cursor,
        includeDiscovered: false,
        includeSharedStorage: true,
      });
      records = result.models;
      nextCursor = sanitizeAssetStringValue(result.nextCursor);
    } catch {
      diagnostics.push(this.diagnostic("warning", "model-resource-backed-view-source-failed", "Model inventory source failed while listing resource-backed views.", {
        failureKind: "source-exception",
      }));
      return { views: [] };
    }

    const views: AssetResourceBackedView[] = [];
    for (const record of records) {
      const view = this.viewFromModelInventoryRecord(record, diagnostics);
      if (!view || !matchesQuery(view, query)) continue;
      views.push(view);
      if (views.length >= limit) break;
    }
    return { views, ...(nextCursor ? { nextCursor } : {}) };
  }

  private viewFromDatasetDescriptor(
    descriptor: DatasetDescriptor,
    diagnostics: AssetResourceBackedViewProviderDiagnostic[],
  ): AssetResourceBackedView | undefined {
    const datasetIdentity = safeIdentity(descriptor.id, "dataset");
    if (!datasetIdentity) {
      diagnostics.push(this.diagnostic("warning", "dataset-resource-backed-view-skipped-invalid-descriptor", "A dataset descriptor was skipped because its identifier was invalid."));
      return undefined;
    }

    if (hasUnsafeDatasetDescriptorData(descriptor)) {
      diagnostics.push(this.diagnostic("warning", "dataset-resource-backed-view-unsafe-data-omitted", "Unsafe dataset descriptor fields were omitted from a resource-backed view."));
    }

    const displayName = safeDisplayName(descriptor.name) ?? datasetIdentity.safeLabel;
    const sourceRef = datasetSourceRef(datasetIdentity, displayName);
    const backing: AssetResourceBacking = sanitizeAssetViewValue({
      backingId: `dataset.internal.${stableHash(datasetIdentity.raw)}`,
      resourceKind: "dataset",
      ref: sourceRef,
      role: "primary",
      displayName,
      createdAt: safeTimestamp(descriptor.createdAt),
      metadata: metadataOf({
        workspaceId: descriptor.workspaceId,
        datasetId: datasetIdentity.publicId,
        sourceArtifactCount: descriptor.sourceArtifacts?.length,
        transformCount: descriptor.transforms?.length,
        materializationCount: descriptor.materializations?.length,
        schema: safeSchemaSummary(descriptor.schema),
        materializationSummary: materializationSummary(descriptor.materializations),
        ...safePublicMetadata(descriptor.metadata),
      }),
    }) as AssetResourceBacking;
    const assetRef: AssetReference = {
      kind: "resource-backed-asset",
      id: normalizeAssetId(`dataset.${datasetIdentity.publicId}`),
      label: displayName,
      metadata: metadataOf({ datasetId: datasetIdentity.publicId }),
    };

    return sanitizeAssetViewValue({
      viewId: `${DATASET_VIEW_ID_PREFIX}${datasetIdentity.directId ?? stableHash(datasetIdentity.raw)}`,
      viewKind: "dataset",
      assetType: "dataset" satisfies AssetType,
      assetFamily: "resource-backed" satisfies AssetFamily,
      assetDefinitionRef: builtInDefinitionRef("builtin.dataset"),
      resourceBacking: backing,
      resourceBackedAsset: this.mappingService.mapBackingToResourceBackedAsset(assetRef, backing, "dataset"),
      sourceRef,
      displayName,
      summary: "Dataset descriptor resource-backed view; not a registered Asset Kernel instance.",
      metadata: metadataOf({
        workspaceId: descriptor.workspaceId,
        datasetId: datasetIdentity.publicId,
        sourceArtifactCount: descriptor.sourceArtifacts?.length,
        transformCount: descriptor.transforms?.length,
        materializationCount: descriptor.materializations?.length,
        schema: safeSchemaSummary(descriptor.schema),
        materializationSummary: materializationSummary(descriptor.materializations),
        createdAt: safeTimestamp(descriptor.createdAt),
        ...safePublicMetadata(descriptor.metadata),
      }),
    }) as AssetResourceBackedView;
  }

  private viewFromModelInventoryRecord(
    record: ModelInventoryRecord,
    diagnostics: AssetResourceBackedViewProviderDiagnostic[],
  ): AssetResourceBackedView | undefined {
    const modelIdentity = safeIdentity(record.modelRecordId, "model");
    if (!modelIdentity) {
      diagnostics.push(this.diagnostic("warning", "model-resource-backed-view-skipped-invalid-record", "A model inventory record was skipped because its identifier was invalid."));
      return undefined;
    }

    if (hasUnsafeModelRecordData(record)) {
      diagnostics.push(this.diagnostic("warning", "model-resource-backed-view-unsafe-data-omitted", "Unsafe model inventory fields were omitted from a resource-backed view."));
    }

    const displayName = safeDisplayName(record.displayName) ?? modelIdentity.safeLabel;
    const sourceRef = modelSourceRef(modelIdentity, displayName);
    const backingArtifactIds = safeIdentityList(record.backingArtifactIds, "artifact");
    const primaryArtifactId = record.primaryArtifactId ? safeIdentity(record.primaryArtifactId, "artifact")?.publicId : undefined;
    const backing: AssetResourceBacking = sanitizeAssetViewValue({
      backingId: `model.internal.${stableHash(modelIdentity.raw)}`,
      resourceKind: "model",
      ref: sourceRef,
      role: "primary",
      displayName,
      sizeBytes: safeNonNegativeNumber(record.sizeBytes),
      createdAt: safeTimestamp(record.createdAt),
      updatedAt: safeTimestamp(record.updatedAt),
      metadata: metadataOf({
        workspaceId: record.workspaceId,
        modelRecordId: modelIdentity.publicId,
        modelId: safeModelId(record.modelId),
        source: safeLabelValue(record.source),
        provider: safeLabelValue(record.provider),
        lifecycleStatus: safeLabelValue(record.lifecycleStatus),
        artifactForm: safeLabelValue(record.artifactForm),
        taskTags: safeLabelList(record.taskTags),
        inferenceMode: safeLabelValue(record.inferenceMode),
        serializationFormat: safeLabelValue(record.serializationFormat),
        parameterCount: safeNonNegativeNumber(record.parameterCount),
        backingArtifactIds,
        backingArtifactCount: backingArtifactIds?.length,
        primaryArtifactId,
        baseModelId: safeModelId(record.baseModelId),
        generatedFromRunId: safeModelId(record.generatedFromRunId),
        adapterOfModelId: safeModelId(record.adapterOfModelId),
        validationStatus: safeLabelValue(record.validationStatus),
        published: safePublishedSummary(record.published),
        ...safePublicMetadata(record.metadata),
      }),
    }) as AssetResourceBacking;
    const assetRef: AssetReference = {
      kind: "resource-backed-asset",
      id: normalizeAssetId(`model.${modelIdentity.publicId}`),
      label: displayName,
      metadata: metadataOf({ modelRecordId: modelIdentity.publicId }),
    };

    return sanitizeAssetViewValue({
      viewId: `${MODEL_VIEW_ID_PREFIX}${modelIdentity.directId ?? stableHash(modelIdentity.raw)}`,
      viewKind: "model",
      assetType: "model" satisfies AssetType,
      assetFamily: "resource-backed" satisfies AssetFamily,
      assetDefinitionRef: builtInDefinitionRef("builtin.model"),
      resourceBacking: backing,
      resourceBackedAsset: this.mappingService.mapBackingToResourceBackedAsset(assetRef, backing, "model"),
      sourceRef,
      displayName,
      summary: "Persisted model inventory resource-backed view; not a registered Asset Kernel instance.",
      lifecycleStatus: lifecycleFromModelStatus(record.lifecycleStatus),
      validationSummary: validationSummaryFromModel(record),
      metadata: metadataOf({
        workspaceId: record.workspaceId,
        modelRecordId: modelIdentity.publicId,
        modelId: safeModelId(record.modelId),
        source: safeLabelValue(record.source),
        provider: safeLabelValue(record.provider),
        lifecycleStatus: safeLabelValue(record.lifecycleStatus),
        artifactForm: safeLabelValue(record.artifactForm),
        taskTags: safeLabelList(record.taskTags),
        inferenceMode: safeLabelValue(record.inferenceMode),
        serializationFormat: safeLabelValue(record.serializationFormat),
        parameterCount: safeNonNegativeNumber(record.parameterCount),
        sizeBytes: safeNonNegativeNumber(record.sizeBytes),
        backingArtifactIds,
        backingArtifactCount: backingArtifactIds?.length,
        primaryArtifactId,
        baseModelId: safeModelId(record.baseModelId),
        generatedFromRunId: safeModelId(record.generatedFromRunId),
        adapterOfModelId: safeModelId(record.adapterOfModelId),
        validationStatus: safeLabelValue(record.validationStatus),
        published: safePublishedSummary(record.published),
        createdAt: safeTimestamp(record.createdAt),
        updatedAt: safeTimestamp(record.updatedAt),
        ...safePublicMetadata(record.metadata),
      }),
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
      sourceKind: "dataset-model",
      ...(metadataOf(metadata) ? { metadata: metadataOf(metadata) } : {}),
    };
  }
}

export function createAssetDatasetModelResourceBackedViewProvider(
  dependencies: AssetDatasetModelResourceBackedViewProviderDependencies = {},
): AssetDatasetModelResourceBackedViewProvider {
  return new AssetDatasetModelResourceBackedViewProvider(dependencies);
}

interface SafeIdentity {
  readonly raw: string;
  readonly publicId: string;
  readonly safeLabel: string;
  readonly directId?: string;
}

function safeIdentity(value: string | undefined, fallbackPrefix: string): SafeIdentity | undefined {
  const raw = typeof value === "string" ? value.trim() : undefined;
  if (!raw) return undefined;
  const pathLikeOrUnsafe = looksPathLike(raw) || isUnsafeAssetMetadataString(raw);
  if (!pathLikeOrUnsafe) {
    const publicId = stableToken(raw);
    return { raw, publicId, safeLabel: raw, ...(publicId === raw ? { directId: publicId } : {}) };
  }
  const publicId = `${fallbackPrefix}.${stableHash(raw)}`;
  return { raw, publicId, safeLabel: publicId };
}

function datasetSourceRef(identity: SafeIdentity, label: string): AssetReference {
  return {
    kind: "resource",
    id: normalizeAssetId(`dataset-ref.${identity.publicId}`),
    label,
    metadata: metadataOf({ datasetId: identity.publicId }),
  };
}

function modelSourceRef(identity: SafeIdentity, label: string): AssetReference {
  return {
    kind: "resource",
    id: normalizeAssetId(`model-ref.${identity.publicId}`),
    label,
    metadata: metadataOf({ modelRecordId: identity.publicId }),
  };
}

function builtInDefinitionRef(id: "builtin.dataset" | "builtin.model"): AssetReference {
  return {
    kind: "asset-definition",
    id: normalizeAssetId(id),
    version: BUILT_IN_ASSET_DEFINITION_VERSION,
  };
}

function metadataOf(value: Record<string, unknown> | AssetMetadata | undefined): AssetMetadata | undefined {
  return sanitizeAssetMetadata(value);
}

function lifecycleFromModelStatus(status: ModelInventoryRecord["lifecycleStatus"]): AssetLifecycleStatus {
  switch (status) {
    case "validated":
      return "validated";
    case "invalid":
      return "failed-validation";
    case "downloaded":
    case "saved-reference":
    case "generated":
      return "draft";
    default:
      return "draft";
  }
}

function validationSummaryFromModel(record: ModelInventoryRecord): AssetResourceBackedView["validationSummary"] | undefined {
  if (!record.validationStatus) return undefined;
  const status = record.validationStatus === "valid" ? "valid" : record.validationStatus === "invalid" ? "invalid" : record.validationStatus === "warning" ? "valid-with-warnings" : "unknown";
  return { status, metadata: metadataOf({ modelValidationStatus: record.validationStatus }) };
}

function safePublicMetadata(metadata: UnknownRecord | undefined): AssetMetadata | undefined {
  if (!metadata) return undefined;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (isProviderUnsafeMetadataKey(key)) continue;
    const sanitized = sanitizeSafePublicValue(value);
    if (typeof sanitized !== "undefined") safe[key] = sanitized;
  }
  return metadataOf(safe);
}

function sanitizeSafePublicValue(value: unknown): unknown {
  if (typeof value === "string") {
    const sanitized = sanitizeAssetStringValue(value);
    if (!sanitized || looksPathLike(sanitized)) return undefined;
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
      .filter(([key]) => !isProviderUnsafeMetadataKey(key))
      .map(([key, entry]) => [key, sanitizeSafePublicValue(entry)] as const)
      .filter((entry): entry is readonly [string, unknown] => typeof entry[1] !== "undefined");
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return undefined;
}

function safeSchemaSummary(schema: DatasetSchemaSummary | undefined): AssetMetadata | undefined {
  if (!schema) return undefined;
  const fields = schema.fields
    ?.map((field) => ({
      name: safeLabelValue(field.name),
      type: safeLabelValue(field.type),
      ...(typeof field.nullable === "boolean" ? { nullable: field.nullable } : {}),
    }))
    .filter((field) => field.name && field.type);
  return metadataOf({
    fieldCount: safeNonNegativeNumber(schema.fieldCount),
    ...(fields?.length ? { fields } : {}),
  });
}

function materializationSummary(materializations: readonly DatasetMaterializationDescriptor[] | undefined): AssetMetadata | undefined {
  if (!materializations?.length) return undefined;
  const formats = [...new Set(materializations.map((item) => safeLabelValue(item.format)).filter((item): item is string => Boolean(item)))].sort();
  const rowCounts = materializations
    .map((item) => safeNonNegativeNumber(item.rowCount))
    .filter((item): item is number => typeof item === "number");
  const totalRows = rowCounts.length ? rowCounts.reduce((sum, count) => sum + count, 0) : undefined;
  return metadataOf({
    materializationCount: materializations.length,
    ...(formats.length ? { formats } : {}),
    ...(typeof totalRows === "number" ? { totalRows } : {}),
  });
}

function safePublishedSummary(published: ModelInventoryRecord["published"] | undefined): AssetMetadata | undefined {
  if (!published) return undefined;
  return metadataOf({
    provider: safeLabelValue(published.provider),
    repository: safeRepositoryLabel(published.repository),
    revision: safeRepositoryLabel(published.revision),
    publishedAt: safeTimestamp(published.publishedAt),
  });
}

function safeIdentityList(values: readonly string[] | undefined, fallbackPrefix: string): string[] | undefined {
  const safe = values
    ?.map((value) => safeIdentity(value, fallbackPrefix)?.publicId)
    .filter((value): value is string => Boolean(value));
  return safe?.length ? safe : undefined;
}

function safeLabelList(values: readonly string[] | undefined): string[] | undefined {
  const safe = values?.map(safeLabelValue).filter((value): value is string => Boolean(value));
  return safe?.length ? safe : undefined;
}

function safeLabelValue(value: string | undefined): string | undefined {
  const sanitized = sanitizeAssetStringValue(value);
  if (!sanitized || looksPathLike(sanitized) || sanitized.length > 120) return undefined;
  return sanitized;
}

function safeModelId(value: string | undefined): string | undefined {
  const sanitized = sanitizeAssetStringValue(value);
  if (!sanitized || looksPathLike(sanitized) || sanitized.length > 160) return undefined;
  return sanitized;
}

function safeRepositoryLabel(value: string | undefined): string | undefined {
  const sanitized = sanitizeAssetStringValue(value);
  if (!sanitized || looksPathLike(sanitized) || sanitized.length > 200) return undefined;
  return sanitized;
}

function safeDisplayName(value: string | undefined): string | undefined {
  const sanitized = sanitizeAssetStringValue(value);
  if (!sanitized || looksPathLike(sanitized) || /^data:/i.test(sanitized)) return undefined;
  return sanitized;
}

function safeTimestamp(value: string | undefined): string | undefined {
  const sanitized = sanitizeAssetStringValue(value);
  if (!sanitized || looksPathLike(sanitized)) return undefined;
  return sanitized;
}

function safeNonNegativeNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function hasUnsafeDatasetDescriptorData(value: DatasetDescriptor): boolean {
  return hasUnsafeData({
    id: value.id,
    name: value.name,
    sourceArtifacts: value.sourceArtifacts,
    materializations: value.materializations,
    metadata: value.metadata,
  });
}

function hasUnsafeModelRecordData(value: ModelInventoryRecord): boolean {
  return hasUnsafeData(value);
}

function hasUnsafeData(value: unknown): boolean {
  if (typeof value === "string") return isUnsafeAssetMetadataString(value) || looksPathLike(value);
  if (Array.isArray(value)) return value.some((entry) => hasUnsafeData(entry));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value as Record<string, unknown>).some(([key, entry]) => isProviderUnsafeMetadataKey(key) || hasUnsafeData(entry));
  }
  return false;
}

function isProviderUnsafeMetadataKey(key: string): boolean {
  return isUnsafeAssetMetadataKey(key) || /^(localPath|checkpointPath|checkpoint|validationReportPath|outputDirectory|outputDir|cacheDirectory|cacheDir|hfCache|huggingFaceCache|materializationPath|sourcePath|sourceFile|sourceFiles|filePath|directory|rawConfig|providerNativeConfig|trainingLog|validationReport|commandLine|requestId|taskId)$/i.test(key);
}

function looksPathLike(value: string): boolean {
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

function allowsViewKind(query: AssetResourceBackedViewListQuery, viewKind: AssetResourceBackedViewKind): boolean {
  return !query.viewKinds?.length || query.viewKinds.includes(viewKind);
}

function allowsAssetType(query: AssetResourceBackedViewListQuery, assetType: AssetType): boolean {
  return !query.assetTypes?.length || query.assetTypes.includes(assetType);
}

function allowsAssetFamily(query: AssetResourceBackedViewListQuery): boolean {
  return !query.assetFamilies?.length || query.assetFamilies.includes("resource-backed");
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
      view.sourceRef?.id,
      view.resourceBacking?.displayName,
    ])
  );
}

function matchesSearch(searchText: string | undefined, values: readonly (string | undefined)[]): boolean {
  const needle = searchText?.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => value?.toLowerCase().includes(needle));
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

function parseDirectViewId(viewId: string, prefix: string): string | undefined {
  if (!viewId.startsWith(prefix)) return undefined;
  const candidate = viewId.slice(prefix.length);
  if (!candidate || !/^[a-z0-9_.-]+$/i.test(candidate)) return undefined;
  return candidate;
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
