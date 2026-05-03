import type { ApplicationRequestContext } from "../../../application/ports";
import type { ArtifactRepoStoragePort, HuggingFaceRepoBrowserPort } from "../../../application/ports/storage";
import { createContractError, type ContractErrorCode } from "../../../contracts/shared";
import {
  createHasArtifactInRepoFailureResult,
  createHasArtifactInRepoSuccessResult,
  createRetrieveArtifactFromRepoFailureResult,
  createRetrieveArtifactFromRepoSuccessResult,
  createStoreArtifactInRepoFailureResult,
  createStoreArtifactInRepoSuccessResult,
  type ArtifactRepoTarget,
  type HasArtifactInRepoRequest,
  type RetrieveArtifactFromRepoRequest,
  type StoreArtifactInRepoRequest,
} from "../../../contracts/storage";

const HUGGING_FACE_PROVIDER = "huggingface" as const;
const DEFAULT_REVISION = "main" as const;
const DEFAULT_HUB_BASE_URL = "https://huggingface.co" as const;

type HuggingFaceRepoType = "dataset" | "model";

class HuggingFaceAdapterValidationError extends Error {}
class HuggingFaceHubClientUnavailableError extends Error {}

export interface HuggingFaceFetchResponseHeaders {
  get: (header: string) => string | null;
}

export interface HuggingFaceFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: HuggingFaceFetchResponseHeaders;
  arrayBuffer: () => Promise<ArrayBuffer>;
  json: <T = unknown>() => Promise<T>;
}

export type HuggingFaceFetchImplementation = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<HuggingFaceFetchResponse>;

interface ResolvedHuggingFaceTarget {
  readonly repoType: HuggingFaceRepoType;
  readonly repositoryName: string;
  readonly revision: string;
  readonly pathInRepo: string;
}

interface ResolvedHuggingFaceRepositoryIdentity {
  readonly namespace: string;
  readonly name: string;
}

interface HuggingFaceRepoDesignation {
  type: HuggingFaceRepoType;
  name: string;
}

type HuggingFaceRepoBrowserErrorCode = "validation" | "not-found" | "unavailable" | "internal";

type HuggingFaceOperation =
  | "hasArtifactInRepo"
  | "storeArtifactInRepo"
  | "retrieveArtifactFromRepo"
  | "listNamespaceDatasets"
  | "listDatasetParquetFiles";

interface HuggingFaceHubClient {
  fileExists: (params: {
    repo: HuggingFaceRepoDesignation;
    path: string;
    revision?: string;
    accessToken?: string;
    hubUrl?: string;
    fetch?: HuggingFaceFetchImplementation;
  }) => Promise<boolean>;
  uploadFile: (params: {
    repo: HuggingFaceRepoDesignation;
    file: {
      path: string;
      content: Blob | Uint8Array;
    };
    branch?: string;
    commitTitle?: string;
    accessToken?: string;
    hubUrl?: string;
    fetch?: HuggingFaceFetchImplementation;
  }) => Promise<unknown>;
  downloadFile: (params: {
    repo: HuggingFaceRepoDesignation;
    path: string;
    revision?: string;
    accessToken?: string;
    hubUrl?: string;
    fetch?: HuggingFaceFetchImplementation;
  }) => Promise<HuggingFaceFetchResponse>;
}

function toUploadContent(content: Uint8Array, mediaType?: string): Blob | Uint8Array {
  if (typeof Blob === "undefined") {
    return content;
  }

  const blobContent = new Uint8Array(content);
  return new Blob([blobContent], {
    type: mediaType?.trim() || "application/octet-stream",
  });
}

export interface CreateHuggingFaceArtifactRepoStorageAdapterOptions {
  accessToken?: string;
  accessTokenProvider?: () => string | undefined;
  fetchImplementation?: HuggingFaceFetchImplementation;
  hubBaseUrl?: string;
  defaultRepoType?: HuggingFaceRepoType;
  hubClient?: HuggingFaceHubClient;
  officialHubClientLoader?: (
    fetchImplementation: HuggingFaceFetchImplementation,
    hubBaseUrl: string,
  ) => Promise<HuggingFaceHubClient>;
}

function resolveRequestContext(
  context: ApplicationRequestContext = {},
  requestContext?: { requestId?: string; correlationId?: string },
): ApplicationRequestContext {
  return {
    requestId: context.requestId ?? requestContext?.requestId,
    correlationId: context.correlationId ?? requestContext?.correlationId,
  };
}

function ensureHuggingFaceProvider(target: ArtifactRepoTarget): void {
  if (target.provider !== HUGGING_FACE_PROVIDER) {
    throw new HuggingFaceAdapterValidationError(
      `Hugging Face artifact-repo adapter requires provider \"huggingface\". Received \"${target.provider}\".`,
    );
  }
}

function normalizePathInRepo(target: ArtifactRepoTarget): string {
  const candidate = target.path?.trim();
  if (!candidate) {
    throw new HuggingFaceAdapterValidationError("Artifact-repo target.path is required for Hugging Face operations.");
  }

  if (candidate.startsWith("/")) {
    throw new HuggingFaceAdapterValidationError("Artifact-repo target.path must be repository-relative and must not start with '/'.");
  }

  const segments = candidate.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new HuggingFaceAdapterValidationError(
      "Artifact-repo target.path must not contain empty segments, '.' segments, or '..' segments.",
    );
  }

  return candidate;
}

function normalizeRepositoryParts(repository: string): { repoTypePrefix?: string; repoName: string } {
  const normalized = repository.trim();
  if (!normalized) {
    throw new HuggingFaceAdapterValidationError("Artifact-repo target.repository must be a non-empty string.");
  }

  const prefixSplit = normalized.match(/^(datasets|models)\/(.+)$/i);
  if (prefixSplit) {
    return {
      repoTypePrefix: prefixSplit[1]?.toLowerCase(),
      repoName: prefixSplit[2] ?? "",
    };
  }

  return {
    repoName: normalized,
  };
}

function resolveRepoType(
  target: ArtifactRepoTarget,
  defaultRepoType: HuggingFaceRepoType,
): { repoType: HuggingFaceRepoType; repoName: string } {
  const repositoryParts = normalizeRepositoryParts(target.repository);
  if (repositoryParts.repoTypePrefix === "datasets") {
    return {
      repoType: "dataset",
      repoName: repositoryParts.repoName,
    };
  }

  if (repositoryParts.repoTypePrefix === "models") {
    return {
      repoType: "model",
      repoName: repositoryParts.repoName,
    };
  }

  return {
    repoType: defaultRepoType,
    repoName: repositoryParts.repoName,
  };
}

function resolveTarget(
  target: ArtifactRepoTarget,
  defaultRepoType: HuggingFaceRepoType,
): ResolvedHuggingFaceTarget {
  ensureHuggingFaceProvider(target);

  const { repoType, repoName } = resolveRepoType(target, defaultRepoType);
  if (!repoName.includes("/")) {
    throw new HuggingFaceAdapterValidationError(
      "Artifact-repo target.repository must include namespace and repository name (for example: owner/repo).",
    );
  }

  return {
    repoType,
    repositoryName: repoName,
    revision: target.revision?.trim() || DEFAULT_REVISION,
    pathInRepo: normalizePathInRepo(target),
  };
}

function mapStatusToContractCode(status: number): ContractErrorCode {
  if (status === 400 || status === 422) {
    return "validation";
  }

  if (status === 404) {
    return "not-found";
  }

  if (status === 401 || status === 403 || status === 429 || status >= 500) {
    return "unavailable";
  }

  return "internal";
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getProviderStatusCode(error: unknown): number | undefined {
  if (!isObjectRecord(error)) {
    return undefined;
  }

  const statusCode = error.statusCode;
  if (typeof statusCode === "number") {
    return statusCode;
  }

  const status = error.status;
  if (typeof status === "number") {
    return status;
  }

  return undefined;
}

function getProviderErrorReason(error: unknown): string | undefined {
  if (!isObjectRecord(error)) {
    return undefined;
  }

  if (typeof error.message === "string" && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error.error === "string" && error.error.trim().length > 0) {
    return error.error;
  }

  return undefined;
}

function createAuthRequiredError(operation: HuggingFaceOperation): ReturnType<typeof createContractError> {
  return createContractError(
    "unavailable",
    `Hugging Face ${operation} requires authentication, but no access token is configured.`,
    {
      details: {
        provider: HUGGING_FACE_PROVIDER,
        authIssue: "missing-token",
        guidance: "Configure HF_TOKEN or HUGGING_FACE_TOKEN in the host/server environment.",
      },
    },
  );
}

function mapProviderStatusError(
  operation: HuggingFaceOperation,
  statusCode: number,
  accessToken: string | undefined,
  reason: string | undefined,
) {
  if (statusCode === 401 || statusCode === 403) {
    const tokenMissing = !accessToken?.trim();
    const message = tokenMissing
      ? `Hugging Face ${operation} requires an access token for this repository. No token is configured.`
      : `Hugging Face ${operation} failed authentication (token invalid/insufficient or repository access denied).`;

    return createContractError(
      "unavailable",
      message,
      {
        details: {
          provider: HUGGING_FACE_PROVIDER,
          providerStatus: statusCode,
          authIssue: tokenMissing ? "missing-token" : "invalid-token-or-access-denied",
          reason,
          guidance: tokenMissing
            ? "Configure HF_TOKEN or HUGGING_FACE_TOKEN in the host/server environment."
            : "Verify the configured Hugging Face token and repository permissions (private/gated access).",
        },
      },
    );
  }

  return createContractError(
    mapStatusToContractCode(statusCode),
    `Hugging Face ${operation} failed with provider status ${statusCode}.`,
    {
      details: {
        providerStatus: statusCode,
        reason,
      },
    },
  );
}

function extractMediaType(contentType: string | null): string | undefined {
  if (!contentType) {
    return undefined;
  }

  const normalized = contentType.split(";")[0]?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function toRepoDesignation(target: ResolvedHuggingFaceTarget): HuggingFaceRepoDesignation {
  return {
    type: target.repoType,
    name: target.repositoryName,
  };
}

function resolveRepositoryIdentity(repositoryName: string): ResolvedHuggingFaceRepositoryIdentity {
  const [namespace, ...nameSegments] = repositoryName.split("/");
  const name = nameSegments.join("/");

  if (!namespace?.trim() || !name.trim()) {
    throw new HuggingFaceAdapterValidationError(
      "Artifact-repo target.repository must include namespace and repository name (for example: owner/repo).",
    );
  }

  return {
    namespace: namespace.trim(),
    name: name.trim(),
  };
}

function assertHubClient(client: Partial<HuggingFaceHubClient>): HuggingFaceHubClient {
  if (
    typeof client.fileExists !== "function"
    || typeof client.uploadFile !== "function"
    || typeof client.downloadFile !== "function"
  ) {
    throw new HuggingFaceHubClientUnavailableError(
      "The @huggingface/hub client is unavailable or missing required methods (fileExists/uploadFile/downloadFile).",
    );
  }

  return client as HuggingFaceHubClient;
}

async function loadOfficialHubClient(
  fetchImplementation: HuggingFaceFetchImplementation,
  hubBaseUrl: string,
): Promise<HuggingFaceHubClient> {
  const dynamicImport = new Function("return import('@huggingface/hub');") as () => Promise<unknown>;
  const loaded = await dynamicImport() as Partial<HuggingFaceHubClient>;
  const hubClient = assertHubClient(loaded);

  return {
    fileExists(params) {
      return hubClient.fileExists({
        ...params,
        fetch: params.fetch ?? fetchImplementation,
        hubUrl: params.hubUrl ?? hubBaseUrl,
      });
    },
    uploadFile(params) {
      return hubClient.uploadFile({
        ...params,
        fetch: params.fetch ?? fetchImplementation,
        hubUrl: params.hubUrl ?? hubBaseUrl,
      });
    },
    downloadFile(params) {
      return hubClient.downloadFile({
        ...params,
        fetch: params.fetch ?? fetchImplementation,
        hubUrl: params.hubUrl ?? hubBaseUrl,
      });
    },
  };
}

function mapUnexpectedHubError(
  operation: HuggingFaceOperation,
  error: unknown,
  accessToken: string | undefined,
  diagnostics?: Record<string, unknown>,
) {
  if (error instanceof HuggingFaceHubClientUnavailableError) {
    return createContractError("unavailable", error.message, {
      details: {
        ...diagnostics,
        reason: error.message,
      },
    });
  }

  if (error instanceof HuggingFaceAdapterValidationError) {
    return createContractError("validation", `Hugging Face ${operation} failed unexpectedly.`, {
      details: {
        ...diagnostics,
        reason: error.message,
      },
    });
  }

  const providerStatus = getProviderStatusCode(error);
  if (providerStatus !== undefined) {
    return mapProviderStatusError(
      operation,
      providerStatus,
      accessToken,
      getProviderErrorReason(error),
    );
  }

  if (
    typeof error === "object"
    && error !== null
    && "code" in error
    && "message" in error
    && typeof (error as { code?: unknown }).code === "string"
  ) {
    return createContractError(
      (error as { code: ContractErrorCode }).code,
      String((error as { message?: unknown }).message ?? `Hugging Face ${operation} failed.`),
      {
        details: "details" in (error as Record<string, unknown>) && typeof (error as { details?: unknown }).details === "object"
          ? (error as { details?: Record<string, unknown> }).details
          : undefined,
      },
    );
  }

  return createContractError("internal", `Hugging Face ${operation} failed unexpectedly.`, {
    details: {
      ...diagnostics,
      reason: error instanceof Error ? error.message : String(error),
    },
  });
}

function isRepositoryMissingStatus(error: unknown): boolean {
  return getProviderStatusCode(error) === 404;
}

function logHuggingFaceOperation(
  operation: HuggingFaceOperation,
  event: "start" | "success" | "error",
  metadata: Record<string, unknown>,
): void {
  const payload = {
    operation,
    event,
    ...metadata,
  };
  if (event === "error") {
    console.error("[huggingface-artifact-repo]", payload);
    return;
  }
  console.info("[huggingface-artifact-repo]", payload);
}

function toRepoBrowserError(error: ReturnType<typeof mapUnexpectedHubError>): {
  code: HuggingFaceRepoBrowserErrorCode;
  message: string;
  details?: Readonly<Record<string, unknown>>;
} {
  const narrowedCode: HuggingFaceRepoBrowserErrorCode = (
    error.code === "validation"
    || error.code === "not-found"
    || error.code === "unavailable"
    || error.code === "internal"
  )
    ? error.code
    : "internal";

  return {
    code: narrowedCode,
    message: error.message,
    details: error.details,
  };
}

export function createHuggingFaceArtifactRepoStorageAdapter(
  options: CreateHuggingFaceArtifactRepoStorageAdapterOptions = {},
): ArtifactRepoStoragePort & HuggingFaceRepoBrowserPort {
  const fallbackToken = options.accessToken ?? process.env.HF_TOKEN ?? process.env.HUGGING_FACE_TOKEN;
  const accessTokenProvider = options.accessTokenProvider;
  const getAccessToken = () => accessTokenProvider?.() ?? fallbackToken;
  const maybeFetchImplementation = options.fetchImplementation
    ?? (globalThis as { fetch?: HuggingFaceFetchImplementation }).fetch;
  if (!maybeFetchImplementation) {
    throw new HuggingFaceHubClientUnavailableError(
      "Fetch implementation is unavailable. Provide options.fetchImplementation or a global fetch implementation.",
    );
  }
  const resolvedFetchImplementation: HuggingFaceFetchImplementation = maybeFetchImplementation;
  const hubBaseUrl = options.hubBaseUrl?.replace(/\/$/, "") ?? DEFAULT_HUB_BASE_URL;
  const defaultRepoType = options.defaultRepoType ?? "dataset";
  const providedHubClient = options.hubClient;
  const officialHubClientLoader = options.officialHubClientLoader ?? loadOfficialHubClient;
  let lazyHubClientPromise: Promise<HuggingFaceHubClient> | undefined;

  async function resolveHubClient(): Promise<HuggingFaceHubClient> {
    if (providedHubClient) {
      return assertHubClient(providedHubClient);
    }

    if (!lazyHubClientPromise) {
      lazyHubClientPromise = officialHubClientLoader(resolvedFetchImplementation, hubBaseUrl)
        .catch((error) => {
          throw new HuggingFaceHubClientUnavailableError(
            `Failed to initialize @huggingface/hub client: ${error instanceof Error ? error.message : String(error)}.`,
          );
        });
    }

    return lazyHubClientPromise;
  }

  function normalizeNamespace(namespace: string): string {
    const normalized = namespace.trim();
    if (!normalized) {
      throw new HuggingFaceAdapterValidationError("namespace must be a non-empty string.");
    }
    return normalized;
  }

  function normalizeDatasetRepository(repository: string): string {
    const normalized = repository.trim().replace(/^datasets\//i, "");
    if (!normalized || !normalized.includes("/")) {
      throw new HuggingFaceAdapterValidationError(
        "repository must include namespace and dataset name (for example: owner/repo).",
      );
    }
    return normalized;
  }

  function toDatasetTreeBrowsePath(repository: string, revision: string): string {
    const [namespace, ...datasetNameSegments] = repository.split("/");
    const datasetName = datasetNameSegments.join("/");
    if (!namespace?.trim() || !datasetName.trim()) {
      throw new HuggingFaceAdapterValidationError(
        "repository must include namespace and dataset name (for example: owner/repo).",
      );
    }

    const encodedNamespace = encodeURIComponent(namespace.trim());
    const encodedDatasetName = encodeURIComponent(datasetName.trim());
    const encodedRevision = encodeURIComponent(revision);
    return `/api/datasets/${encodedNamespace}/${encodedDatasetName}/tree/${encodedRevision}?recursive=1`;
  }

  async function fetchJsonFromHub<T>(path: string, operation: HuggingFaceOperation, context: ApplicationRequestContext): Promise<T> {
    const headers: Record<string, string> = {};
    const token = getAccessToken()?.trim();
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    const response = await resolvedFetchImplementation(`${hubBaseUrl}${path}`, { headers });
    if (!response.ok) {
      throw mapProviderStatusError(operation, response.status, token, response.statusText);
    }

    try {
      return await response.json() as T;
    } catch (error) {
      throw createContractError("internal", `Hugging Face ${operation} returned invalid JSON.`, {
        details: {
          requestId: context.requestId,
          correlationId: context.correlationId,
          reason: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  async function createDatasetRepositoryIfMissing(
    target: ResolvedHuggingFaceTarget,
    accessToken: string,
  ): Promise<void> {
    const repositoryIdentity = resolveRepositoryIdentity(target.repositoryName);
    const response = await resolvedFetchImplementation(`${hubBaseUrl}/api/repos/create`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: repositoryIdentity.name,
        organization: repositoryIdentity.namespace,
        type: target.repoType,
      }),
    });

    if (response.ok || response.status === 409) {
      return;
    }

    throw mapProviderStatusError(
      "storeArtifactInRepo",
      response.status,
      accessToken,
      response.statusText,
    );
  }

  async function uploadWithRepoAutoCreateOnNotFound(
    hubClient: HuggingFaceHubClient,
    request: StoreArtifactInRepoRequest,
    target: ResolvedHuggingFaceTarget,
    accessToken: string,
  ): Promise<void> {
    try {
      await hubClient.uploadFile({
        repo: toRepoDesignation(target),
        file: {
          path: target.pathInRepo,
          content: toUploadContent(request.content, request.mediaType),
        },
        branch: target.revision,
        commitTitle: `Store ${target.pathInRepo} via ai-system-builder artifact-repo adapter`,
        accessToken,
      });
      return;
    } catch (error) {
      if (!isRepositoryMissingStatus(error)) {
        throw error;
      }
    }

    await createDatasetRepositoryIfMissing(target, accessToken);

    await hubClient.uploadFile({
      repo: toRepoDesignation(target),
      file: {
        path: target.pathInRepo,
        content: toUploadContent(request.content, request.mediaType),
      },
      branch: target.revision,
      commitTitle: `Store ${target.pathInRepo} via ai-system-builder artifact-repo adapter`,
      accessToken,
    });
  }

  const hasArtifactInRepo: ArtifactRepoStoragePort["hasArtifactInRepo"] = async (
    request: HasArtifactInRepoRequest,
    context: ApplicationRequestContext = {},
  ) => {
    const requestContext = resolveRequestContext(context);

    try {
      const resolvedTarget = resolveTarget(request.target, defaultRepoType);
      const hubClient = await resolveHubClient();
      const exists = await hubClient.fileExists({
        repo: toRepoDesignation(resolvedTarget),
        path: resolvedTarget.pathInRepo,
        revision: resolvedTarget.revision,
        accessToken: getAccessToken(),
      });

      return createHasArtifactInRepoSuccessResult(exists, requestContext);
    } catch (error) {
      return createHasArtifactInRepoFailureResult(
        mapUnexpectedHubError("hasArtifactInRepo", error, getAccessToken()),
        requestContext,
      );
    }
  };

  const storeArtifactInRepo: ArtifactRepoStoragePort["storeArtifactInRepo"] = async (
    request: StoreArtifactInRepoRequest,
    context: ApplicationRequestContext = {},
  ) => {
    const requestContext = resolveRequestContext(context);

    try {
      const resolvedTarget = resolveTarget(request.target, defaultRepoType);
      const token = getAccessToken()?.trim();
      logHuggingFaceOperation("storeArtifactInRepo", "start", {
        repository: resolvedTarget.repositoryName,
        repoType: resolvedTarget.repoType,
        pathInRepo: resolvedTarget.pathInRepo,
        revision: resolvedTarget.revision,
        hasAccessToken: Boolean(token),
        contentSizeBytes: request.content.byteLength,
        requestId: requestContext.requestId,
        correlationId: requestContext.correlationId,
      });
      if (!token) {
        logHuggingFaceOperation("storeArtifactInRepo", "error", {
          repository: resolvedTarget.repositoryName,
          pathInRepo: resolvedTarget.pathInRepo,
          revision: resolvedTarget.revision,
          hasAccessToken: false,
          requestId: requestContext.requestId,
          correlationId: requestContext.correlationId,
          reason: "missing-access-token",
        });
        return createStoreArtifactInRepoFailureResult(
          createAuthRequiredError("storeArtifactInRepo"),
          requestContext,
        );
      }
      const hubClient = await resolveHubClient();
      await uploadWithRepoAutoCreateOnNotFound(
        hubClient,
        request,
        resolvedTarget,
        token,
      );
      logHuggingFaceOperation("storeArtifactInRepo", "success", {
        repository: resolvedTarget.repositoryName,
        pathInRepo: resolvedTarget.pathInRepo,
        revision: resolvedTarget.revision,
        hasAccessToken: true,
        contentSizeBytes: request.content.byteLength,
        requestId: requestContext.requestId,
        correlationId: requestContext.correlationId,
      });

      return createStoreArtifactInRepoSuccessResult(
        {
          target: request.target,
          mediaType: request.mediaType,
          sizeBytes: request.content.byteLength,
        },
        requestContext,
      );
    } catch (error) {
      const mappedError = mapUnexpectedHubError(
        "storeArtifactInRepo",
        error,
        getAccessToken(),
        {
          repository: request.target.repository,
          pathInRepo: request.target.path,
          revision: request.target.revision,
          hasAccessToken: Boolean(getAccessToken()?.trim()),
          contentSizeBytes: request.content.byteLength,
        },
      );
      logHuggingFaceOperation("storeArtifactInRepo", "error", {
        repository: request.target.repository,
        pathInRepo: request.target.path,
        revision: request.target.revision,
        requestId: requestContext.requestId,
        correlationId: requestContext.correlationId,
        errorCode: mappedError.code,
        errorMessage: mappedError.message,
        details: mappedError.details,
      });
      return createStoreArtifactInRepoFailureResult(
        mappedError,
        requestContext,
      );
    }
  };

  const retrieveArtifactFromRepo: ArtifactRepoStoragePort["retrieveArtifactFromRepo"] = async (
    request: RetrieveArtifactFromRepoRequest,
    context: ApplicationRequestContext = {},
  ) => {
    const requestContext = resolveRequestContext(context);

    try {
      const resolvedTarget = resolveTarget(request.target, defaultRepoType);
      const hubClient = await resolveHubClient();
      const response = await hubClient.downloadFile({
        repo: toRepoDesignation(resolvedTarget),
        path: resolvedTarget.pathInRepo,
        revision: resolvedTarget.revision,
        accessToken: getAccessToken(),
      });
      if (!response.ok) {
        return createRetrieveArtifactFromRepoFailureResult(
          mapProviderStatusError(
            "retrieveArtifactFromRepo",
            response.status,
            getAccessToken(),
            response.statusText,
          ),
          requestContext,
        );
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      return createRetrieveArtifactFromRepoSuccessResult(
        {
          target: request.target,
          mediaType: extractMediaType(response.headers.get("content-type")),
          sizeBytes: bytes.byteLength,
        },
        bytes,
        requestContext,
      );
    } catch (error) {
      return createRetrieveArtifactFromRepoFailureResult(
        mapUnexpectedHubError("retrieveArtifactFromRepo", error, getAccessToken()),
        requestContext,
      );
    }
  };

  const listNamespaceDatasets: HuggingFaceRepoBrowserPort["listNamespaceDatasets"] = async (
    namespace: string,
    context: ApplicationRequestContext = {},
  ) => {
    const requestContext = resolveRequestContext(context);

    try {
      const normalizedNamespace = normalizeNamespace(namespace);
      const payload = await fetchJsonFromHub<Array<{ id?: unknown }>>(
        `/api/datasets?author=${encodeURIComponent(normalizedNamespace)}&limit=100`,
        "listNamespaceDatasets",
        requestContext,
      );
      if (!Array.isArray(payload)) {
        return {
          ok: false as const,
          error: toRepoBrowserError(
            createContractError("internal", "Unexpected Hugging Face datasets response shape."),
          ),
          ...requestContext,
        };
      }

      const datasets = payload
        .map((entry) => (typeof entry.id === "string" ? entry.id.trim() : ""))
        .filter((repository) => repository.length > 0 && repository.startsWith(`${normalizedNamespace}/`))
        .map((repository) => ({ namespace: normalizedNamespace, repository }));

      return {
        ok: true as const,
        value: {
          namespace: normalizedNamespace,
          datasets,
        },
        ...requestContext,
      };
    } catch (error) {
      return {
        ok: false as const,
        error: toRepoBrowserError(mapUnexpectedHubError("listNamespaceDatasets", error, getAccessToken())),
        ...requestContext,
      };
    }
  };

  const listDatasetParquetFiles: HuggingFaceRepoBrowserPort["listDatasetParquetFiles"] = async (
    input: { repository: string; revision?: string },
    context: ApplicationRequestContext = {},
  ) => {
    const requestContext = resolveRequestContext(context);
    try {
      const repository = normalizeDatasetRepository(input.repository);
      const revision = input.revision?.trim() || DEFAULT_REVISION;
      const payload = await fetchJsonFromHub<Array<{ path?: unknown; type?: unknown; size?: unknown }>>(
        toDatasetTreeBrowsePath(repository, revision),
        "listDatasetParquetFiles",
        requestContext,
      );
      if (!Array.isArray(payload)) {
        return {
          ok: false as const,
          error: toRepoBrowserError(
            createContractError("internal", "Unexpected Hugging Face dataset tree response shape."),
          ),
          ...requestContext,
        };
      }

      const files = payload
        .filter((entry) => (entry.type === "file" || typeof entry.type !== "string"))
        .map((entry) => ({
          path: typeof entry.path === "string" ? entry.path.trim() : "",
          sizeBytes: typeof entry.size === "number" ? entry.size : undefined,
        }))
        .filter((entry) => entry.path.length > 0)
        .map((entry) => ({
          repository,
          path: entry.path,
          revision,
          sizeBytes: entry.sizeBytes,
        }));

      return {
        ok: true as const,
        value: {
          repository,
          revision,
          files,
        },
        ...requestContext,
      };
    } catch (error) {
      return {
        ok: false as const,
        error: toRepoBrowserError(mapUnexpectedHubError("listDatasetParquetFiles", error, getAccessToken())),
        ...requestContext,
      };
    }
  };

  return {
    hasArtifactInRepo,
    storeArtifactInRepo,
    retrieveArtifactFromRepo,
    listNamespaceDatasets,
    listDatasetParquetFiles,
  };
}
