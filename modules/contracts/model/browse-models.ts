import { normalizeModelTaskTags, type ModelTaskTag } from "../../domain/model";
import { normalizeModelBrowseProvider, type ModelBrowseProvider } from "./model-browse-provider";
import { normalizeModelInferenceMode, type ModelInferenceMode } from "./model-inference-mode";

export type ModelBrowseSort = "downloads" | "likes" | "lastModified" | "relevance";
export type SortDirection = "asc" | "desc";

export const DEFAULT_BROWSE_MODELS_LIMIT = 25;
export const MAX_BROWSE_MODELS_LIMIT = 100;

export interface BrowseModelsRequest {
  provider: ModelBrowseProvider;
  query?: string;
  taskTags?: ModelTaskTag[];
  authorOrOrg?: string;
  limit?: number;
  cursor?: string;
  sort?: ModelBrowseSort;
  direction?: SortDirection;
}

export interface ModelBrowseItem {
  provider: ModelBrowseProvider;
  modelId: string;
  displayName: string;
  authorOrOrg?: string;
  description?: string;
  taskTags?: ModelTaskTag[];
  downloads?: number;
  likes?: number;
  license?: string;
  lastModified?: string;
  inferenceMode?: ModelInferenceMode;
  modelSizeLabel?: string;
  gated?: boolean;
  private?: boolean;
}

export interface BrowseModelsResult {
  models: ModelBrowseItem[];
  nextCursor?: string;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeOptionalNonNegativeNumber(value: number | undefined): number | undefined {
  if (typeof value !== "number") {
    return undefined;
  }

  return value >= 0 ? value : undefined;
}

function normalizeBrowseLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_BROWSE_MODELS_LIMIT;
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    return DEFAULT_BROWSE_MODELS_LIMIT;
  }

  if (limit > MAX_BROWSE_MODELS_LIMIT) {
    return MAX_BROWSE_MODELS_LIMIT;
  }

  return limit;
}

export function normalizeBrowseModelsRequest(request: BrowseModelsRequest): BrowseModelsRequest {
  return {
    provider: normalizeModelBrowseProvider(request.provider),
    query: normalizeOptionalText(request.query),
    taskTags: normalizeModelTaskTags(request.taskTags),
    authorOrOrg: normalizeOptionalText(request.authorOrOrg),
    limit: normalizeBrowseLimit(request.limit),
    cursor: normalizeOptionalText(request.cursor),
    sort: request.sort,
    direction: request.direction,
  };
}

export function normalizeModelBrowseItem(item: ModelBrowseItem): ModelBrowseItem {
  const modelId = item.modelId.trim();
  const displayName = item.displayName.trim();
  if (modelId.length === 0) {
    throw new Error("Model browse item modelId must be a non-empty trimmed string.");
  }
  if (displayName.length === 0) {
    throw new Error("Model browse item displayName must be a non-empty trimmed string.");
  }

  return {
    ...item,
    provider: normalizeModelBrowseProvider(item.provider),
    modelId,
    displayName,
    authorOrOrg: normalizeOptionalText(item.authorOrOrg),
    description: normalizeOptionalText(item.description),
    taskTags: normalizeModelTaskTags(item.taskTags),
    downloads: normalizeOptionalNonNegativeNumber(item.downloads),
    likes: normalizeOptionalNonNegativeNumber(item.likes),
    license: normalizeOptionalText(item.license),
    lastModified: normalizeOptionalText(item.lastModified),
    inferenceMode:
      typeof item.inferenceMode === "string"
        ? normalizeModelInferenceMode(item.inferenceMode)
        : undefined,
    modelSizeLabel: normalizeOptionalText(item.modelSizeLabel),
    gated: typeof item.gated === "boolean" ? item.gated : undefined,
    private: typeof item.private === "boolean" ? item.private : undefined,
  };
}

export function normalizeBrowseModelsResult(result: BrowseModelsResult): BrowseModelsResult {
  return {
    models: result.models.map((model) => normalizeModelBrowseItem(model)),
    nextCursor: normalizeOptionalText(result.nextCursor),
  };
}
