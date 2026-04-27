import type { ArtifactBrowseItem as ArtifactBrowseContractItem } from "../../../../../../modules/contracts/artifact-browser";
import { resolveArtifactFamily as resolveCanonicalArtifactFamily } from "../../../../../../modules/application/shared/artifact-family-classifier";

export interface ArtifactBrowserLocator {
  storageKey: string;
}

type ThinClientArtifactFamily = ArtifactBrowseContractItem["artifactFamily"];

export interface ThinClientArtifactBrowseItem {
  storageKey: string;
  artifactFamily: ThinClientArtifactFamily;
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

export interface ArtifactBrowserApiClient {
  getHuggingFaceTokenStatus: () => Promise<{ configured: boolean; maskedToken?: string }>;
  setHuggingFaceToken: (input: { token: string }) => Promise<{ configured: boolean; maskedToken?: string }>;
  clearHuggingFaceToken: () => Promise<{ configured: boolean; maskedToken?: string }>;
  browseHuggingFaceNamespaceDatasets?: (input: { namespace: string }) => Promise<ThinClientHuggingFaceNamespaceDataset[]>;
  browseHuggingFaceDatasetParquetFiles?: (input: { repository: string; revision?: string }) => Promise<ThinClientHuggingFaceDatasetParquetFile[]>;
  browseArtifacts: (input?: { artifactFamily?: ThinClientArtifactFamily }) => Promise<ThinClientArtifactBrowseItem[]>;
  readArtifactDetail: (locator: ArtifactBrowserLocator) => Promise<ThinClientArtifactDetail>;
  readArtifactContent: (locator: ArtifactBrowserLocator) => Promise<ThinClientArtifactContentDescriptor>;
  createArtifactMediaViewUrl: (locator: ArtifactBrowserLocator) => string;
  publishArtifactToHuggingFace: (input: {
    artifactId: string;
    repository: string;
    path: string;
    revision?: string;
    mediaType?: string;
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
    artifactId: string;
  }) => Promise<ThinClientLocalizedArtifactFromRepo>;
}

interface ApiResponseEnvelope {
  ok: boolean;
  value?: unknown;
  error?: {
    message?: string;
  };
}

function createApiUrl(apiBaseUrl: string, suffix: string): string {
  return `${apiBaseUrl.trim().replace(/\/+$/, "") || "/api"}${suffix}`;
}

function ensureEnvelope(value: unknown): ApiResponseEnvelope {
  if (typeof value === "object" && value !== null && "ok" in value) {
    return value as ApiResponseEnvelope;
  }

  throw new Error("Artifact browser response is not a valid API envelope.");
}

function ensureSuccess<T>(response: ApiResponseEnvelope, pick: (value: unknown) => T): T {
  if (!response.ok) {
    throw new Error(response.error?.message ?? "Artifact browser request failed.");
  }

  return pick(response.value);
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
      const response = await fetch(createApiUrl(apiBaseUrl, "/config/huggingface-token"), {
        method: "GET",
      });
      const envelope = ensureEnvelope((await response.json()) as unknown);
      return ensureSuccess(envelope, (value) => value as { configured: boolean; maskedToken?: string });
    },

    async setHuggingFaceToken(input) {
      const response = await fetch(createApiUrl(apiBaseUrl, "/config/huggingface-token"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ token: input.token }),
      });
      const envelope = ensureEnvelope((await response.json()) as unknown);
      return ensureSuccess(envelope, (value) => value as { configured: boolean; maskedToken?: string });
    },

    async clearHuggingFaceToken() {
      const response = await fetch(createApiUrl(apiBaseUrl, "/config/huggingface-token"), {
        method: "DELETE",
      });
      const envelope = ensureEnvelope((await response.json()) as unknown);
      return ensureSuccess(envelope, (value) => value as { configured: boolean; maskedToken?: string });
    },

    async browseHuggingFaceNamespaceDatasets(input) {
      const response = await fetch(createApiUrl(apiBaseUrl, "/huggingface/namespace/datasets"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          namespace: input.namespace,
          source,
        }),
      });
      const envelope = ensureEnvelope((await response.json()) as unknown);
      return ensureSuccess(envelope, (value) => {
        const datasets = (value as { datasets?: ThinClientHuggingFaceNamespaceDataset[] } | undefined)?.datasets;
        return Array.isArray(datasets) ? datasets : [];
      });
    },

    async browseHuggingFaceDatasetParquetFiles(input) {
      const response = await fetch(createApiUrl(apiBaseUrl, "/huggingface/dataset/parquet-files"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          repository: input.repository,
          revision: input.revision,
          source,
        }),
      });
      const envelope = ensureEnvelope((await response.json()) as unknown);
      return ensureSuccess(envelope, (value) => {
        const files = (value as { files?: ThinClientHuggingFaceDatasetParquetFile[] } | undefined)?.files;
        return Array.isArray(files) ? files : [];
      });
    },

    async browseArtifacts(input = {}): Promise<ThinClientArtifactBrowseItem[]> {
      const response = await fetch(createApiUrl(apiBaseUrl, "/artifact/browse"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ artifactFamily: input.artifactFamily, source }),
      });

      const envelope = ensureEnvelope((await response.json()) as unknown);
      return ensureSuccess(envelope, (value) => {
        const items = (value as { items?: ThinClientArtifactBrowseItem[] } | undefined)?.items;
        return Array.isArray(items) ? items : [];
      });
    },

    async readArtifactDetail(locator: ArtifactBrowserLocator): Promise<ThinClientArtifactDetail> {
      const response = await fetch(createApiUrl(apiBaseUrl, "/artifact/read"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ locator, source }),
      });

      const envelope = ensureEnvelope((await response.json()) as unknown);
      return ensureSuccess(envelope, (value) => {
        const artifact = (value as { artifact?: ThinClientArtifactDetail } | undefined)?.artifact;
        if (!artifact) {
          throw new Error("Artifact read response is missing artifact detail.");
        }

        return artifact;
      });
    },

    async readArtifactContent(
      locator: ArtifactBrowserLocator,
    ): Promise<ThinClientArtifactContentDescriptor> {
      const response = await fetch(createApiUrl(apiBaseUrl, "/artifact/content/read"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ locator, source }),
      });

      const envelope = ensureEnvelope((await response.json()) as unknown);
      return ensureSuccess(envelope, (value) => {
        const content = (value as { content?: ThinClientArtifactContentDescriptor } | undefined)?.content;
        if (!content) {
          throw new Error("Artifact content-read response is missing descriptor content.");
        }

        return content;
      });
    },

    createArtifactMediaViewUrl(locator: ArtifactBrowserLocator): string {
      const query = new URLSearchParams({ storageKey: locator.storageKey });
      return createApiUrl(apiBaseUrl, `/artifact/media/view?${query.toString()}`);
    },

    async publishArtifactToHuggingFace(input): Promise<ThinClientPublishedBacking> {
      const response = await fetch(createApiUrl(apiBaseUrl, "/artifact/publish"), {
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
          verify: true,
          source,
        }),
      });

      const envelope = ensureEnvelope((await response.json()) as unknown);
      return ensureSuccess(envelope, (value) => {
        const backing = value as ThinClientPublishedBacking;
        if (!backing || typeof backing !== "object") {
          throw new Error("Artifact publish response is missing backing information.");
        }

        return backing;
      });
    },

    async verifyPublishedArtifactBacking(input): Promise<ThinClientPublishedBacking> {
      const response = await fetch(createApiUrl(apiBaseUrl, "/artifact/publish/verify"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          artifactId: input.artifactId,
          source,
        }),
      });

      const envelope = ensureEnvelope((await response.json()) as unknown);
      return ensureSuccess(envelope, (value) => {
        const backing = value as ThinClientPublishedBacking;
        if (!backing || typeof backing !== "object") {
          throw new Error("Artifact publish verify response is missing backing information.");
        }

        return backing;
      });
    },

    async verifyImportedSourceBacking(input): Promise<ThinClientPublishedBacking> {
      const response = await fetch(createApiUrl(apiBaseUrl, "/artifact/source/verify"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          artifactId: input.artifactId,
          source,
        }),
      });

      const envelope = ensureEnvelope((await response.json()) as unknown);
      return ensureSuccess(envelope, (value) => {
        const backing = value as ThinClientPublishedBacking;
        if (!backing || typeof backing !== "object") {
          throw new Error("Artifact source verify response is missing backing information.");
        }

        return backing;
      });
    },

    async registerArtifactFromRepo(input): Promise<ThinClientRegisteredArtifactFromRepo> {
      const artifactFamily = resolveCanonicalArtifactFamily({
        mediaType: input.mediaType,
        fileName: input.path,
      });
      const response = await fetch(createApiUrl(apiBaseUrl, "/artifact/register-from-repo"), {
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
      });

      const envelope = ensureEnvelope((await response.json()) as unknown);
      return ensureSuccess(envelope, (value) => {
        const registered = value as ThinClientRegisteredArtifactFromRepo;
        if (!registered || typeof registered !== "object") {
          throw new Error("Artifact register-from-repo response is missing registration information.");
        }

        return registered;
      });
    },

    async localizeArtifactFromRepo(input): Promise<ThinClientLocalizedArtifactFromRepo> {
      const response = await fetch(createApiUrl(apiBaseUrl, "/artifact/localize-from-repo"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          artifactId: input.artifactId,
          source,
        }),
      });

      const envelope = ensureEnvelope((await response.json()) as unknown);
      return ensureSuccess(envelope, (value) => {
        const localized = value as ThinClientLocalizedArtifactFromRepo;
        if (!localized || typeof localized !== "object") {
          throw new Error("Artifact localize-from-repo response is missing localization information.");
        }

        return localized;
      });
    },
  };
}
