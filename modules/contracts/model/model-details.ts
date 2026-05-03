import { normalizeModelBrowseProvider, type ModelBrowseProvider } from "./model-browse-provider";
import { normalizeModelInferenceMode, type ModelInferenceMode } from "./model-inference-mode";
import { normalizeModelBrowseItem, type ModelBrowseItem } from "./browse-models";

export interface GetModelDetailsRequest {
  provider: ModelBrowseProvider;
  modelId: string;
}

export interface ModelFileDescriptor {
  path: string;
  sizeBytes?: number;
  blobId?: string;
  lfs?: boolean;
}

export interface ModelDetails extends ModelBrowseItem {
  cardMarkdown?: string;
  tags?: string[];
  pipelineTag?: string;
  siblings?: string[];
  files?: ModelFileDescriptor[];
  config?: Record<string, unknown>;
  tokenizerAvailable?: boolean;
  safetensorsAvailable?: boolean;
  adapterAvailable?: boolean;
  estimatedParameterCount?: number;
  recommendedInferenceMode?: ModelInferenceMode;
  warnings?: string[];
  metadata?: Record<string, unknown>;
}

export interface GetModelDetailsResult {
  model: ModelDetails;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeStringList(values: readonly string[] | undefined): string[] | undefined {
  const normalized = values
    ?.map((value) => value.trim())
    .filter((value) => value.length > 0);

  return normalized && normalized.length > 0 ? normalized : undefined;
}

function normalizeOptionalNonNegativeNumber(value: number | undefined): number | undefined {
  if (typeof value !== "number") {
    return undefined;
  }

  return value >= 0 ? value : undefined;
}

function normalizeModelFileDescriptor(file: ModelFileDescriptor): ModelFileDescriptor {
  const path = file.path.trim();
  if (path.length === 0) {
    throw new Error("Model file descriptor path must be a non-empty trimmed string.");
  }

  return {
    path,
    sizeBytes: normalizeOptionalNonNegativeNumber(file.sizeBytes),
    blobId: normalizeOptionalText(file.blobId),
    lfs: typeof file.lfs === "boolean" ? file.lfs : undefined,
  };
}

function normalizeModelFileDescriptors(files: readonly ModelFileDescriptor[] | undefined): ModelFileDescriptor[] | undefined {
  if (!files) {
    return undefined;
  }

  const normalized = files.map((file) => normalizeModelFileDescriptor(file));
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeGetModelDetailsRequest(request: GetModelDetailsRequest): GetModelDetailsRequest {
  const modelId = request.modelId.trim();
  if (modelId.length === 0) {
    throw new Error("Get model details request modelId must be a non-empty trimmed string.");
  }

  return {
    provider: normalizeModelBrowseProvider(request.provider),
    modelId,
  };
}

export function normalizeModelDetails(model: ModelDetails): ModelDetails {
  const browseModel = normalizeModelBrowseItem(model);
  const files = normalizeModelFileDescriptors(model.files);
  const siblings = normalizeStringList(model.siblings) ?? files?.map((file) => file.path);

  return {
    ...browseModel,
    cardMarkdown: normalizeOptionalText(model.cardMarkdown),
    tags: normalizeStringList(model.tags),
    pipelineTag: normalizeOptionalText(model.pipelineTag),
    siblings,
    files,
    config: model.config,
    tokenizerAvailable: typeof model.tokenizerAvailable === "boolean" ? model.tokenizerAvailable : undefined,
    safetensorsAvailable: typeof model.safetensorsAvailable === "boolean" ? model.safetensorsAvailable : undefined,
    adapterAvailable: typeof model.adapterAvailable === "boolean" ? model.adapterAvailable : undefined,
    estimatedParameterCount: normalizeOptionalNonNegativeNumber(model.estimatedParameterCount),
    recommendedInferenceMode:
      typeof model.recommendedInferenceMode === "string"
        ? normalizeModelInferenceMode(model.recommendedInferenceMode)
        : undefined,
    warnings: normalizeStringList(model.warnings),
    metadata: model.metadata,
  };
}

export function normalizeGetModelDetailsResult(result: GetModelDetailsResult): GetModelDetailsResult {
  return {
    model: normalizeModelDetails(result.model),
  };
}
