import { secureFetch } from "../../../security/secureFetch";
import type { ArtifactBrowseItem as ArtifactBrowseContractItem } from "../../../../../../modules/contracts/artifact-browser";
import { resolveArtifactFamily as resolveCanonicalArtifactFamily } from "../../../../../../modules/application/shared/artifact-family-classifier";
import {
  parseApiEnvelope,
  toThinClientApiError,
} from "../../../security/apiErrorEnvelope";

export interface ArtifactBrowserLocator {
  storageKey: string;
}

type ThinClientArtifactFamily = ArtifactBrowseContractItem["artifactFamily"];

export interface ThinClientArtifactBrowseItem {
  artifactId: string;
  storageKey: string;
  artifactFamily: ThinClientArtifactFamily;
  sourceKind?: ArtifactBrowseContractItem["sourceKind"];
  mediaType?: string;
  sizeBytes?: number;
  originalName?: string;
  createdAt?: string;
  metadata?: {
    backingState?: {
      hasImportedSourceBacking: boolean;
      hasPublishedBacking: boolean;
      hasLocalObjectAvailable: boolean;
      isLocalized: boolean;
      isRemoteOnly: boolean;
    };
  };
}

export interface ThinClientWebsiteCaptureMetadata {
  sourceUrl: string;
  resolvedUrl: string;
  requestedMode: "automatic" | "rendered";
  acquisitionMechanismUsed: "simple-http" | "rendered-browser";
  retrievedAt: string;
  httpStatus?: number;
  contentTypeHeader?: string;
}

export interface ThinClientArtifactDetail {
  locator: ArtifactBrowserLocator;
  artifactFamily: ThinClientArtifactFamily;
  mediaType?: string;
  sizeBytes?: number;
  sourceKind?: string;
  originalName?: string;
  createdAt?: string;
  metadata?: {
    publishedBacking?: ThinClientPublishedBacking;
    importedSourceBacking?: ThinClientPublishedBacking;
    websiteCapture?: ThinClientWebsiteCaptureMetadata;
  };
}

export interface ThinClientArtifactContentDescriptor {
  locator: ArtifactBrowserLocator;
  mediaType?: string;
  sizeBytes?: number;
  availability: "available" | "unavailable";
  retrieval: "inline" | "deferred";
}

export interface ThinClientPublishedBacking {
  target: {
    provider: string;
    repository: string;
    path: string;
    revision?: string;
    locator?: string;
  };
  verification: {
    exists: boolean;
    verifiedAt?: string;
  };
}

export interface ThinClientRegisteredArtifactFromRepo {
  artifactId: string;
  backing: {
    role: "imported-source";
    target: {
      provider: string;
      repository: string;
      path: string;
      revision: string;
      locator?: string;
    };
    verification: {
      exists: true;
      verifiedAt: string;
    };
  };
}

export interface ThinClientLocalizedArtifactFromRepo {
  artifactId: string;
  localObject: {
    key: string;
    mediaType?: string;
    repositoryCreation?: {
      approved: true;
      visibility: "private" | "public";
    };
    sizeBytes: number;
  };
  source: {
    provider: string;
    repository: string;
    path: string;
    revision?: string;
    locator: string;
  };
  localizedAt: string;
}

export interface ThinClientHuggingFaceNamespaceDataset {
  namespace: string;
  repository: string;
}

export interface ThinClientHuggingFaceDatasetParquetFile {
  repository: string;
  path: string;
  revision: string;
  sizeBytes?: number;
}

export interface ThinClientHuggingFaceFilesImportResult {
  repositories: Array<{
    repository: string;
    revision: string;
    status: "succeeded" | "partial" | "failed";
    message?: string;
    code?: "validation" | "not-found" | "unavailable" | "internal";
    files: Array<{
      repository: string;
      path: string;
      revision: string;
      mediaType?: string;
      status: "registered" | "failed";
      artifactId?: string;
      message?: string;
      code?: "validation" | "not-found" | "unavailable" | "internal";
    }>;
  }>;
  summary: {
    attempted: number;
    succeeded: number;
    failed: number;
  };
}

export interface ArtifactBrowserApiClient {
  getHuggingFaceTokenStatus: () => Promise<{
    configured: boolean;
    maskedToken?: string;
  }>;
  setHuggingFaceToken: (input: {
    token: string;
  }) => Promise<{ configured: boolean; maskedToken?: string }>;
  clearHuggingFaceToken: () => Promise<{
    configured: boolean;
    maskedToken?: string;
  }>;
  browseHuggingFaceNamespaceDatasets?: (input: {
    namespace: string;
  }) => Promise<ThinClientHuggingFaceNamespaceDataset[]>;
  browseHuggingFaceDatasetParquetFiles?: (input: {
    repository: string;
    revision?: string;
  }) => Promise<ThinClientHuggingFaceDatasetParquetFile[]>;
  importHuggingFaceFiles?: (input: {
    repositories?: Array<{ repository: string; revision?: string }>;
    files?: Array<{
      repository: string;
      path: string;
      revision?: string;
      mediaType?: string;
    }>;
  }) => Promise<ThinClientHuggingFaceFilesImportResult>;
  browseArtifacts: (input?: {
    artifactFamily?: ThinClientArtifactFamily;
    workspaceId?: string;
  }) => Promise<ThinClientArtifactBrowseItem[]>;
  readArtifactDetail: (
    locator: ArtifactBrowserLocator,
    input?: { workspaceId?: string },
  ) => Promise<ThinClientArtifactDetail>;
  readArtifactContent: (
    locator: ArtifactBrowserLocator,
    input?: { workspaceId?: string },
  ) => Promise<ThinClientArtifactContentDescriptor>;
  deleteRegisteredArtifact: (
    locator: ArtifactBrowserLocator,
    input?: { workspaceId?: string },
  ) => Promise<{ storageKey: string }>;
  createArtifactMediaViewUrl: (
    locator: ArtifactBrowserLocator,
    input?: { workspaceId?: string; maximumBytes?: number },
  ) => string;
  readArtifactMedia?: (
    locator: ArtifactBrowserLocator,
    input?: { workspaceId?: string; maximumBytes?: number },
  ) => Promise<{ mediaType?: string; bytes: Uint8Array }>;
  publishArtifactToHuggingFace: (input: {
    artifactId: string;
    repository: string;
    path: string;
    revision?: string;
    mediaType?: string;
    repositoryCreation?: {
      approved: true;
      visibility: "private" | "public";
    };
  }) => Promise<ThinClientPublishedBacking>;
  verifyPublishedArtifactBacking: (input: {
    artifactId: string;
  }) => Promise<ThinClientPublishedBacking>;
  verifyImportedSourceBacking?: (input: {
    artifactId: string;
  }) => Promise<ThinClientPublishedBacking>;
  registerArtifactFromRepo: (input: {
    repository: string;
    path: string;
    revision?: string;
    mediaType?: string;
  }) => Promise<ThinClientRegisteredArtifactFromRepo>;
  localizeArtifactFromRepo: (input: {
    workspaceId: string;
    artifactId: string;
  }) => Promise<ThinClientLocalizedArtifactFromRepo>;
}

interface ApiResponseEnvelope {
  ok: boolean;
  value?: unknown;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
    endpoint?: string;
  };
}

export class ArtifactBrowserApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
    public readonly status?: number,
    public readonly endpoint?: string,
  ) {
    super(message);
  }
}

function createApiUrl(apiBaseUrl: string, suffix: string): string {
  return `${apiBaseUrl.trim().replace(/\/+$/, "") || "/api"}${suffix}`;
}

function ensureEnvelope(value: unknown): ApiResponseEnvelope {
  return parseApiEnvelope(value) as ApiResponseEnvelope;
}

function ensureSuccess<T>(
  response: ApiResponseEnvelope,
  status: number,
  endpoint: string,
  pick: (value: unknown) => T,
): T {
  if (!response.ok) {
    const err = toThinClientApiError(status, endpoint, response);
    throw new ArtifactBrowserApiError(
      err.message,
      err.code,
      err.details,
      err.status,
      err.endpoint,
    );
  }
  return pick(response.value);
}

async function requestJson(
  endpoint: string,
  init: RequestInit,
): Promise<{
  status: number;
  endpoint: string;
  envelope: ApiResponseEnvelope;
}> {
  const response = await secureFetch(endpoint, init);
  return {
    status: response.status,
    endpoint,
    envelope: ensureEnvelope((await response.json()) as unknown),
  };
}

export interface CreateApiArtifactBrowserClientOptions {
  apiBaseUrl?: string;
  source?: string;
}

export function createApiArtifactBrowserClient(
  options: CreateApiArtifactBrowserClientOptions = {},
): ArtifactBrowserApiClient {
  const apiBaseUrl = options.apiBaseUrl ?? "/api";
  const source = options.source ?? "thin-client.artifact-browser";

  return {
    async getHuggingFaceTokenStatus() {
      const { status, endpoint, envelope } = await requestJson(
        createApiUrl(apiBaseUrl, "/config/huggingface-token"),
        { method: "GET" },
      );
      return ensureSuccess(
        envelope,
        status,
        endpoint,
        (value) => value as { configured: boolean; maskedToken?: string },
      );
    },

    async setHuggingFaceToken(input) {
      const { status, endpoint, envelope } = await requestJson(
        createApiUrl(apiBaseUrl, "/config/huggingface-token"),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: input.token }),
        },
      );
      return ensureSuccess(
        envelope,
        status,
        endpoint,
        (value) => value as { configured: boolean; maskedToken?: string },
      );
    },

    async clearHuggingFaceToken() {
      const { status, endpoint, envelope } = await requestJson(
        createApiUrl(apiBaseUrl, "/config/huggingface-token"),
        { method: "DELETE" },
      );
      return ensureSuccess(
        envelope,
        status,
        endpoint,
        (value) => value as { configured: boolean; maskedToken?: string },
      );
    },

    async browseHuggingFaceNamespaceDatasets(input) {
      const response = await secureFetch(
        createApiUrl(apiBaseUrl, "/huggingface/namespace/datasets"),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            namespace: input.namespace,
            source,
          }),
        },
      );
      const envelope = ensureEnvelope((await response.json()) as unknown);
      return ensureSuccess(
        envelope,
        response.status,
        createApiUrl(apiBaseUrl, "/huggingface/namespace/datasets"),
        (value) => {
          const datasets = (
            value as
              { datasets?: ThinClientHuggingFaceNamespaceDataset[] } | undefined
          )?.datasets;
          return Array.isArray(datasets) ? datasets : [];
        },
      );
    },

    async browseHuggingFaceDatasetParquetFiles(input) {
      const response = await secureFetch(
        createApiUrl(apiBaseUrl, "/huggingface/dataset/parquet-files"),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            repository: input.repository,
            revision: input.revision,
            source,
          }),
        },
      );
      const envelope = ensureEnvelope((await response.json()) as unknown);
      return ensureSuccess(
        envelope,
        response.status,
        createApiUrl(apiBaseUrl, "/huggingface/dataset/parquet-files"),
        (value) => {
          const files = (
            value as
              { files?: ThinClientHuggingFaceDatasetParquetFile[] } | undefined
          )?.files;
          return Array.isArray(files) ? files : [];
        },
      );
    },

    async importHuggingFaceFiles(input) {
      const response = await secureFetch(
        createApiUrl(apiBaseUrl, "/huggingface/files/import"),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            repositories: input.repositories,
            files: input.files,
            source,
          }),
        },
      );
      const envelope = ensureEnvelope((await response.json()) as unknown);
      return ensureSuccess(
        envelope,
        response.status,
        createApiUrl(apiBaseUrl, "/huggingface/files/import"),
        (value) => {
          const result = value as ThinClientHuggingFaceFilesImportResult;
          if (!result || typeof result !== "object" || !("summary" in result)) {
            throw new Error(
              "Hugging Face import response is missing summary information.",
            );
          }
          return result;
        },
      );
    },

    async browseArtifacts(input = {}): Promise<ThinClientArtifactBrowseItem[]> {
      const response = await secureFetch(
        createApiUrl(apiBaseUrl, "/artifact/browse"),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            artifactFamily: input.artifactFamily,
            workspaceId: input.workspaceId,
            source,
          }),
        },
      );

      const envelope = ensureEnvelope((await response.json()) as unknown);
      return ensureSuccess(envelope, response.status, "", (value) => {
        const items = (
          value as { items?: ThinClientArtifactBrowseItem[] } | undefined
        )?.items;
        return Array.isArray(items) ? items : [];
      });
    },

    async readArtifactDetail(
      locator: ArtifactBrowserLocator,
      input = {},
    ): Promise<ThinClientArtifactDetail> {
      const response = await secureFetch(
        createApiUrl(apiBaseUrl, "/artifact/read"),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            locator,
            workspaceId: input.workspaceId,
            source,
          }),
        },
      );

      const envelope = ensureEnvelope((await response.json()) as unknown);
      return ensureSuccess(envelope, response.status, "", (value) => {
        const artifact = (
          value as { artifact?: ThinClientArtifactDetail } | undefined
        )?.artifact;
        if (!artifact) {
          throw new Error("Artifact read response is missing artifact detail.");
        }

        return artifact;
      });
    },

    async readArtifactContent(
      locator: ArtifactBrowserLocator,
      input = {},
    ): Promise<ThinClientArtifactContentDescriptor> {
      const response = await secureFetch(
        createApiUrl(apiBaseUrl, "/artifact/content/read"),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            locator,
            workspaceId: input.workspaceId,
            source,
          }),
        },
      );

      const envelope = ensureEnvelope((await response.json()) as unknown);
      return ensureSuccess(envelope, response.status, "", (value) => {
        const content = (
          value as { content?: ThinClientArtifactContentDescriptor } | undefined
        )?.content;
        if (!content) {
          throw new Error(
            "Artifact content-read response is missing descriptor content.",
          );
        }

        return content;
      });
    },

    async deleteRegisteredArtifact(
      locator: ArtifactBrowserLocator,
      input = {},
    ): Promise<{ storageKey: string }> {
      const response = await secureFetch(
        createApiUrl(apiBaseUrl, "/artifact/delete"),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            locator,
            workspaceId: input.workspaceId,
            source,
          }),
        },
      );

      const envelope = ensureEnvelope((await response.json()) as unknown);
      return ensureSuccess(envelope, response.status, "", (value) => {
        const deleted = value as { storageKey?: unknown };
        if (!deleted || typeof deleted.storageKey !== "string") {
          throw new Error(
            "Artifact delete response is missing deleted storage key.",
          );
        }

        return { storageKey: deleted.storageKey };
      });
    },

    createArtifactMediaViewUrl(
      locator: ArtifactBrowserLocator,
      input = {},
    ): string {
      const query = new URLSearchParams({ storageKey: locator.storageKey });
      if (input.workspaceId) {
        query.set("workspaceId", input.workspaceId);
      }
      if (input.maximumBytes !== undefined) {
        query.set("maximumBytes", String(input.maximumBytes));
      }
      return createApiUrl(
        apiBaseUrl,
        `/artifact/media/view?${query.toString()}`,
      );
    },

    async readArtifactMedia(
      locator: ArtifactBrowserLocator,
      input = {},
    ): Promise<{ mediaType?: string; bytes: Uint8Array }> {
      const query = new URLSearchParams({ storageKey: locator.storageKey });
      if (input.workspaceId) {
        query.set("workspaceId", input.workspaceId);
      }
      if (input.maximumBytes !== undefined) {
        query.set("maximumBytes", String(input.maximumBytes));
      }
      const response = await secureFetch(
        createApiUrl(apiBaseUrl, `/artifact/media/view?${query.toString()}`),
        { method: "GET" },
      );
      if (!response.ok) {
        throw new ArtifactBrowserApiError(
          "Failed to read artifact preview media.",
          undefined,
          undefined,
          response.status,
        );
      }

      return {
        mediaType: response.headers.get("content-type") ?? undefined,
        bytes: new Uint8Array(await response.arrayBuffer()),
      };
    },

    async publishArtifactToHuggingFace(
      input,
    ): Promise<ThinClientPublishedBacking> {
      const response = await secureFetch(
        createApiUrl(apiBaseUrl, "/artifact/publish"),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            artifactId: input.artifactId,
            target: {
              provider: "huggingface",
              repository: input.repository,
              revision: input.revision,
              path: input.path,
            },
            mediaType: input.mediaType,
            repositoryCreation: input.repositoryCreation,
            verify: true,
            source,
          }),
        },
      );

      const envelope = ensureEnvelope((await response.json()) as unknown);
      return ensureSuccess(envelope, response.status, "", (value) => {
        const backing = value as ThinClientPublishedBacking;
        if (!backing || typeof backing !== "object") {
          throw new Error(
            "Artifact publish response is missing backing information.",
          );
        }

        return backing;
      });
    },

    async verifyPublishedArtifactBacking(
      input,
    ): Promise<ThinClientPublishedBacking> {
      const response = await secureFetch(
        createApiUrl(apiBaseUrl, "/artifact/publish/verify"),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            artifactId: input.artifactId,
            source,
          }),
        },
      );

      const envelope = ensureEnvelope((await response.json()) as unknown);
      return ensureSuccess(envelope, response.status, "", (value) => {
        const backing = value as ThinClientPublishedBacking;
        if (!backing || typeof backing !== "object") {
          throw new Error(
            "Artifact publish verify response is missing backing information.",
          );
        }

        return backing;
      });
    },

    async verifyImportedSourceBacking(
      input,
    ): Promise<ThinClientPublishedBacking> {
      const response = await secureFetch(
        createApiUrl(apiBaseUrl, "/artifact/source/verify"),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            artifactId: input.artifactId,
            source,
          }),
        },
      );

      const envelope = ensureEnvelope((await response.json()) as unknown);
      return ensureSuccess(envelope, response.status, "", (value) => {
        const backing = value as ThinClientPublishedBacking;
        if (!backing || typeof backing !== "object") {
          throw new Error(
            "Artifact source verify response is missing backing information.",
          );
        }

        return backing;
      });
    },

    async registerArtifactFromRepo(
      input,
    ): Promise<ThinClientRegisteredArtifactFromRepo> {
      const artifactFamily = resolveCanonicalArtifactFamily({
        mediaType: input.mediaType,
        fileName: input.path,
      });
      const response = await secureFetch(
        createApiUrl(apiBaseUrl, "/artifact/register-from-repo"),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            target: {
              provider: "huggingface",
              repository: input.repository,
              revision: input.revision,
              path: input.path,
            },
            artifactFamily,
            mediaType: input.mediaType,
            source,
          }),
        },
      );

      const envelope = ensureEnvelope((await response.json()) as unknown);
      return ensureSuccess(envelope, response.status, "", (value) => {
        const registered = value as ThinClientRegisteredArtifactFromRepo;
        if (!registered || typeof registered !== "object") {
          throw new Error(
            "Artifact register-from-repo response is missing registration information.",
          );
        }

        return registered;
      });
    },

    async localizeArtifactFromRepo(
      input,
    ): Promise<ThinClientLocalizedArtifactFromRepo> {
      const response = await secureFetch(
        createApiUrl(apiBaseUrl, "/artifact/localize-from-repo"),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            workspaceId: input.workspaceId,
            artifactId: input.artifactId,
            source,
          }),
        },
      );

      const envelope = ensureEnvelope((await response.json()) as unknown);
      return ensureSuccess(envelope, response.status, "", (value) => {
        const localized = value as ThinClientLocalizedArtifactFromRepo;
        if (!localized || typeof localized !== "object") {
          throw new Error(
            "Artifact localize-from-repo response is missing localization information.",
          );
        }

        return localized;
      });
    },
  };
}
