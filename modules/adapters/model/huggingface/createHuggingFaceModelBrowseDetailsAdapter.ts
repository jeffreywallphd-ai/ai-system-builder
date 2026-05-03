import type { ModelBrowsePort, ModelDetailsPort } from "../../../application/ports/model";
import {
  normalizeBrowseModelsResult,
  normalizeGetModelDetailsResult,
  normalizeModelDetails,
  recommendModelInferenceMode,
  type BrowseModelsRequest,
  type BrowseModelsResult,
  type GetModelDetailsRequest,
  type GetModelDetailsResult,
  type ModelBrowseItem,
  type ModelDetails,
  type ModelTaskTag,
} from "../../../contracts/model";
import { normalizeModelTaskTag } from "../../../domain/model";

const DEFAULT_HUGGING_FACE_BASE_URL = "https://huggingface.co" as const;

class HuggingFaceModelClientUnavailableError extends Error {}

type HuggingFaceModelOperation = "browseModels" | "getModelDetails";

interface HuggingFaceModelListEntry {
  id?: string;
  modelId?: string;
  name?: string;
  author?: string;
  description?: string;
  pipeline_tag?: string;
  task?: string;
  tags?: string[];
  downloads?: number;
  likes?: number;
  private?: boolean;
  gated?: boolean | string;
  lastModified?: string;
  updatedAt?: Date;
  cardData?: Record<string, unknown>;
}

interface HuggingFaceSibling {
  rfilename?: string;
  path?: string;
  size?: number;
  blobId?: string;
  lfs?: unknown;
}

interface HuggingFaceModelInfo extends HuggingFaceModelListEntry {
  sha?: string;
  config?: Record<string, unknown>;
  siblings?: HuggingFaceSibling[];
  cardData?: Record<string, unknown>;
  license?: string;
  description?: string;
}

interface HuggingFaceModelHubClient {
  listModels(params: {
    search?: {
      query?: string;
      owner?: string;
      task?: string;
      tags?: string[];
    };
    sort?: string;
    limit?: number;
    additionalFields?: string[];
    accessToken?: string;
  }): AsyncIterable<HuggingFaceModelListEntry> | Promise<Iterable<HuggingFaceModelListEntry>>;
  modelInfo(params: {
    name: string;
    accessToken?: string;
    additionalFields?: string[];
  }): Promise<HuggingFaceModelInfo>;
}

export interface CreateHuggingFaceModelBrowseDetailsAdapterOptions {
  accessToken?: string;
  accessTokenProvider?: () => string | undefined;
  hubClient?: HuggingFaceModelHubClient;
  officialHubClientLoader?: () => Promise<HuggingFaceModelHubClient>;
}

function toOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function toOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return normalized.length > 0 ? normalized : undefined;
}

function toOptionalLicense(value: unknown): string | undefined {
  if (typeof value === "string") {
    return toOptionalText(value);
  }

  if (Array.isArray(value)) {
    const licenses = value
      .map((entry) => toOptionalText(entry))
      .filter((entry): entry is string => Boolean(entry));
    return licenses.length > 0 ? licenses.join(", ") : undefined;
  }

  return undefined;
}

function toOptionalTaskTags(tags: readonly string[] | undefined): ModelTaskTag[] | undefined {
  if (!tags) {
    return undefined;
  }

  const normalized: ModelTaskTag[] = [];
  for (const tag of tags) {
    try {
      normalized.push(normalizeModelTaskTag(tag));
    } catch {
      // ignore unknown tags from provider
    }
  }

  return normalized.length > 0 ? normalized : undefined;
}

function selectCardDataTaskTag(cardData: Record<string, unknown> | undefined): string | undefined {
  return cardData ? toOptionalText(cardData["pipeline_tag"]) : undefined;
}

function selectPipelineTag(entry: HuggingFaceModelListEntry): string | undefined {
  return toOptionalText(entry.pipeline_tag)
    ?? toOptionalText(entry.task)
    ?? selectCardDataTaskTag(entry.cardData);
}

function selectTags(entry: HuggingFaceModelListEntry): string[] | undefined {
  const tags = toOptionalStringArray(entry.tags) ?? [];
  const cardTags = toOptionalStringArray(entry.cardData?.["tags"]) ?? [];
  const pipelineTag = selectPipelineTag(entry);
  const combined = [...(pipelineTag ? [pipelineTag] : []), ...tags, ...cardTags];
  return combined.length > 0 ? Array.from(new Set(combined)) : undefined;
}

function selectLicense(entry: HuggingFaceModelListEntry): string | undefined {
  const cardData = entry.cardData;
  const cardLicense = toOptionalLicense(cardData?.["license"])
    ?? toOptionalText(cardData?.["license_name"]);
  if (cardLicense) {
    return cardLicense;
  }

  const licenseTag = selectTags(entry)
    ?.map((tag) => tag.trim())
    .find((tag) => tag.toLowerCase().startsWith("license:"));
  return licenseTag ? toOptionalText(licenseTag.slice("license:".length)) : undefined;
}

function inferDisplayName(modelId: string): string {
  const segments = modelId.split("/");
  return segments[segments.length - 1] ?? modelId;
}

function looksLikeOpaqueProviderId(value: string): boolean {
  return /^[a-f0-9]{24}$/i.test(value);
}

function selectProviderModelId(entry: HuggingFaceModelListEntry): string | undefined {
  const explicitModelId = toOptionalText(entry.modelId);
  if (explicitModelId) {
    return explicitModelId;
  }

  const name = toOptionalText(entry.name);
  if (name && (name.includes("/") || !looksLikeOpaqueProviderId(name))) {
    return name;
  }

  const id = toOptionalText(entry.id);
  if (id && (id.includes("/") || !looksLikeOpaqueProviderId(id))) {
    return id;
  }

  return name ?? id;
}

function inferAuthorOrOrg(modelId: string, explicitAuthor?: string): string | undefined {
  const normalizedExplicit = toOptionalText(explicitAuthor);
  if (normalizedExplicit) {
    return normalizedExplicit;
  }

  const segments = modelId.split("/");
  if (segments.length > 1) {
    return toOptionalText(segments[0]);
  }

  return undefined;
}

function toModelBrowseItem(entry: HuggingFaceModelListEntry): ModelBrowseItem {
  const modelId = selectProviderModelId(entry);
  if (!modelId) {
    throw new Error("Hugging Face listModels entry did not include a model id.");
  }

  const tags = selectTags(entry);
  const pipelineTag = selectPipelineTag(entry);
  const cardData = entry.cardData;
  const description = toOptionalText(entry.description)
    ?? (cardData && typeof cardData["description"] === "string" ? toOptionalText(cardData["description"]) : undefined)
    ?? (cardData && typeof cardData["model_description"] === "string" ? toOptionalText(cardData["model_description"]) : undefined)
    ?? (cardData && typeof cardData["summary"] === "string" ? toOptionalText(cardData["summary"]) : undefined);

  return {
    provider: "huggingface",
    modelId,
    displayName: inferDisplayName(modelId),
    authorOrOrg: inferAuthorOrOrg(modelId, entry.author),
    description,
    taskTags: toOptionalTaskTags(tags),
    downloads: typeof entry.downloads === "number" ? entry.downloads : undefined,
    likes: typeof entry.likes === "number" ? entry.likes : undefined,
    license: selectLicense(entry),
    lastModified: toOptionalText(entry.lastModified) ?? entry.updatedAt?.toISOString(),
    inferenceMode: recommendModelInferenceMode({ pipelineTag, taskTags: tags }),
    gated: typeof entry.gated === "boolean" ? entry.gated : typeof entry.gated === "string" ? true : undefined,
    private: typeof entry.private === "boolean" ? entry.private : undefined,
  };
}

function inferTokenizerAvailability(filePaths: readonly string[]): boolean | undefined {
  if (filePaths.length === 0) {
    return undefined;
  }

  return filePaths.some((path) =>
    /(^|\/)(tokenizer\.json|tokenizer_config\.json|vocab\.json|merges\.txt|spiece\.model)$/i.test(path)
  );
}

function inferSafetensorsAvailability(filePaths: readonly string[]): boolean | undefined {
  if (filePaths.length === 0) {
    return undefined;
  }

  return filePaths.some((path) => path.toLowerCase().endsWith(".safetensors"));
}

function inferAdapterAvailability(filePaths: readonly string[]): boolean | undefined {
  if (filePaths.length === 0) {
    return undefined;
  }

  return filePaths.some((path) => /adapter_config\.json$/i.test(path) || /lora/i.test(path));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorStatus(error: unknown): number | undefined {
  if (!isObject(error)) {
    return undefined;
  }

  if (typeof error.statusCode === "number") {
    return error.statusCode;
  }

  if (typeof error.status === "number") {
    return error.status;
  }

  return undefined;
}

function mapHuggingFaceError(operation: HuggingFaceModelOperation, error: unknown): Error {
  if (error instanceof HuggingFaceModelClientUnavailableError) {
    return error;
  }

  const status = getErrorStatus(error);
  if (status === 401 || status === 403) {
    return new Error(`Hugging Face ${operation} failed: unauthorized or access denied.`);
  }

  if (status === 404) {
    return new Error(`Hugging Face ${operation} failed: model was not found.`);
  }

  if (status === 429) {
    return new Error(`Hugging Face ${operation} failed: rate limited by provider.`);
  }

  if (status !== undefined && status >= 500) {
    return new Error(`Hugging Face ${operation} failed: provider unavailable.`);
  }

  return new Error(
    `Hugging Face ${operation} failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
  );
}

function assertHubClient(client: Partial<HuggingFaceModelHubClient>): HuggingFaceModelHubClient {
  if (typeof client.listModels !== "function" || typeof client.modelInfo !== "function") {
    throw new HuggingFaceModelClientUnavailableError(
      "The @huggingface/hub client is unavailable or missing required methods (listModels/modelInfo).",
    );
  }

  return client as HuggingFaceModelHubClient;
}

async function loadOfficialHubClient(): Promise<HuggingFaceModelHubClient> {
  const dynamicImport = new Function("return import('@huggingface/hub');") as () => Promise<unknown>;
  const loaded = await dynamicImport() as Partial<HuggingFaceModelHubClient>;
  return assertHubClient(loaded);
}

async function collectListModels(
  iterableLike: AsyncIterable<HuggingFaceModelListEntry> | Promise<Iterable<HuggingFaceModelListEntry>>,
): Promise<HuggingFaceModelListEntry[]> {
  const resolved = await iterableLike;
  if (Symbol.asyncIterator in Object(resolved)) {
    const rows: HuggingFaceModelListEntry[] = [];
    for await (const row of resolved as AsyncIterable<HuggingFaceModelListEntry>) {
      rows.push(row);
    }
    return rows;
  }

  return Array.from(resolved as Iterable<HuggingFaceModelListEntry>);
}

export function createHuggingFaceModelBrowseDetailsAdapter(
  options: CreateHuggingFaceModelBrowseDetailsAdapterOptions = {},
): ModelBrowsePort & ModelDetailsPort {
  const fallbackAccessToken = options.accessToken;
  const accessTokenProvider = options.accessTokenProvider;
  const officialHubClientLoader = options.officialHubClientLoader ?? loadOfficialHubClient;

  const resolveAccessToken = () => accessTokenProvider?.() ?? fallbackAccessToken;
  let lazyHubClient: Promise<HuggingFaceModelHubClient> | undefined;
  const expandedModelFields = ["author", "cardData", "config", "sha", "tags", "safetensors", "transformersInfo"] as const;

  async function resolveHubClient(): Promise<HuggingFaceModelHubClient> {
    if (options.hubClient) {
      return assertHubClient(options.hubClient);
    }

    if (!lazyHubClient) {
      lazyHubClient = officialHubClientLoader().catch((error) => {
        throw new HuggingFaceModelClientUnavailableError(
          `Failed to initialize @huggingface/hub client: ${error instanceof Error ? error.message : String(error)}.`,
        );
      });
    }

    return lazyHubClient;
  }

  return {
    async browseModels(request: BrowseModelsRequest): Promise<BrowseModelsResult> {
      try {
        const hubClient = await resolveHubClient();
        const items = await collectListModels(hubClient.listModels({
          search: {
            query: request.query,
            owner: request.authorOrOrg,
            task: request.taskTags?.[0],
            tags: request.taskTags && request.taskTags.length > 1 ? request.taskTags.slice(1) : undefined,
          },
          sort: request.sort,
          limit: request.limit,
          additionalFields: [...expandedModelFields],
          accessToken: resolveAccessToken(),
        }));

        const models = items.map((entry) => toModelBrowseItem(entry));
        return normalizeBrowseModelsResult({
          models,
          // @huggingface/hub listModels does not expose a stable cursor in this adapter slice.
          nextCursor: undefined,
        });
      } catch (error) {
        throw mapHuggingFaceError("browseModels", error);
      }
    },

    async getModelDetails(request: GetModelDetailsRequest): Promise<GetModelDetailsResult> {
      try {
        const hubClient = await resolveHubClient();
        const info = await hubClient.modelInfo({
          name: request.modelId,
          accessToken: resolveAccessToken(),
          additionalFields: [...expandedModelFields],
        });

        const browseItem = toModelBrowseItem(info);
        const cardData = info.cardData;
        const tags = selectTags(info);
        const pipelineTag = selectPipelineTag(info);
        const siblings = info.siblings ?? [];
        const files = siblings
          .map((sibling) => {
            const path = toOptionalText(sibling.rfilename) ?? toOptionalText(sibling.path);
            if (!path) {
              return undefined;
            }

            return {
              path,
              sizeBytes: typeof sibling.size === "number" ? sibling.size : undefined,
              blobId: toOptionalText(sibling.blobId),
              lfs: sibling.lfs !== undefined,
            };
          })
          .filter((file): file is NonNullable<typeof file> => Boolean(file));

        const filePaths = files.map((file) => file.path);
        const model: ModelDetails = normalizeModelDetails({
          ...browseItem,
          description: browseItem.description ?? toOptionalText(info.description),
          cardMarkdown: cardData && typeof cardData["content"] === "string" ? toOptionalText(cardData["content"]) : undefined,
          tags,
          pipelineTag,
          license: browseItem.license ?? toOptionalLicense(info.license),
          siblings: filePaths,
          files,
          config: info.config,
          tokenizerAvailable: inferTokenizerAvailability(filePaths),
          safetensorsAvailable: inferSafetensorsAvailability(filePaths),
          adapterAvailable: inferAdapterAvailability(filePaths),
          recommendedInferenceMode: recommendModelInferenceMode({
            pipelineTag,
            taskTags: tags,
          }),
          metadata: {
            sha: toOptionalText(info.sha),
            baseUrl: DEFAULT_HUGGING_FACE_BASE_URL,
          },
        });

        return normalizeGetModelDetailsResult({ model });
      } catch (error) {
        throw mapHuggingFaceError("getModelDetails", error);
      }
    },
  };
}
