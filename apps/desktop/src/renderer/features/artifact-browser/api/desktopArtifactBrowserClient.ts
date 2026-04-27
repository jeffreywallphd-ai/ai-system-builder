import {
  getDesktopApi,
  type DesktopArtifactBrowseItem,
  type DesktopArtifactBrowserLocator,
  type DesktopArtifactContentDescriptor,
  type DesktopArtifactDetail,
  type DesktopArtifactFamily,
  type DesktopLocalizedArtifactFromRepo,
  type DesktopPublishedBacking,
  type DesktopUnregisteredArtifactBrowseItem,
  type DesktopRegisteredArtifactFromRepo,
  type DesktopHuggingFaceTokenStatus,
  type DesktopHuggingFaceNamespaceDataset,
  type DesktopHuggingFaceDatasetParquetFile,
} from "../../../lib/desktopApi";

export interface DesktopArtifactBrowserClient {
  getHuggingFaceTokenStatus: () => Promise<DesktopHuggingFaceTokenStatus>;
  setHuggingFaceToken: (input: { token: string }) => Promise<DesktopHuggingFaceTokenStatus>;
  clearHuggingFaceToken: () => Promise<DesktopHuggingFaceTokenStatus>;
  browseHuggingFaceNamespaceDatasets?: (input: { namespace: string }) => Promise<DesktopHuggingFaceNamespaceDataset[]>;
  browseHuggingFaceDatasetParquetFiles?: (input: { repository: string; revision?: string }) => Promise<DesktopHuggingFaceDatasetParquetFile[]>;
  browseArtifacts: (input?: { artifactFamily?: DesktopArtifactFamily }) => Promise<DesktopArtifactBrowseItem[]>;
  browseUnregisteredArtifacts?: () => Promise<DesktopUnregisteredArtifactBrowseItem[]>;
  registerUnregisteredArtifact?: (input: { storageKey: string }) => Promise<{ storageKey: string }>;
  deleteUnregisteredArtifact?: (input: { storageKey: string }) => Promise<{ storageKey: string }>;
  deleteRegisteredArtifact?: (input: { storageKey: string }) => Promise<{ storageKey: string }>;
  readArtifactDetail: (locator: DesktopArtifactBrowserLocator) => Promise<DesktopArtifactDetail>;
  readArtifactContent: (locator: DesktopArtifactBrowserLocator) => Promise<DesktopArtifactContentDescriptor>;
  createArtifactMediaViewUrl: (locator: DesktopArtifactBrowserLocator) => Promise<string>;
  readArtifactMedia: (locator: DesktopArtifactBrowserLocator) => Promise<{ mediaType?: string; bytes: Uint8Array }>;
  publishArtifactToHuggingFace: (input: {
    artifactId: string;
    repository: string;
    path: string;
    revision?: string;
    mediaType?: string;
  }) => Promise<DesktopPublishedBacking>;
  verifyPublishedArtifactBacking: (input: {
    artifactId: string;
  }) => Promise<DesktopPublishedBacking>;
  verifyImportedSourceBacking?: (input: {
    artifactId: string;
  }) => Promise<DesktopPublishedBacking>;
  registerArtifactFromRepo: (input: {
    repository: string;
    path: string;
    revision?: string;
    mediaType?: string;
  }) => Promise<DesktopRegisteredArtifactFromRepo>;
  localizeArtifactFromRepo: (input: {
    artifactId: string;
  }) => Promise<DesktopLocalizedArtifactFromRepo>;
}

function toBrowseItems(value: unknown): DesktopArtifactBrowseItem[] {
  if (Array.isArray(value)) {
    return value as DesktopArtifactBrowseItem[];
  }

  if (typeof value !== "object" || value === null) {
    return [];
  }

  const payload = value as {
    items?: DesktopArtifactBrowseItem[];
    registeredItems?: DesktopArtifactBrowseItem[];
    registered?: { items?: DesktopArtifactBrowseItem[] };
    registeredItemsMap?: Record<string, DesktopArtifactBrowseItem>;
  };

  if (Array.isArray(payload.items)) {
    return payload.items;
  }

  if (Array.isArray(payload.registeredItems)) {
    return payload.registeredItems;
  }

  if (Array.isArray(payload.registered?.items)) {
    return payload.registered.items;
  }

  if (payload.registeredItemsMap && typeof payload.registeredItemsMap === "object") {
    return Object.values(payload.registeredItemsMap);
  }

  return [];
}

function ensureSuccess<T>(
  response: unknown,
  pick: (value: unknown) => T,
  fallback: string,
): T {
  if (typeof response !== "object" || response === null || !("ok" in response)) {
    throw new Error(fallback);
  }

  const envelope = response as { ok: boolean; value?: unknown; error?: { message?: string } };
  if (!envelope.ok) {
    throw new Error(envelope.error?.message ?? fallback);
  }

  return pick(envelope.value);
}

export function createDesktopArtifactBrowserClient(): DesktopArtifactBrowserClient {
  const desktopApi = getDesktopApi();

  return {
    async getHuggingFaceTokenStatus() {
      return ensureSuccess(
        await desktopApi.getHuggingFaceTokenStatus(),
        (value) => value as DesktopHuggingFaceTokenStatus,
        "Failed to read Hugging Face token status.",
      );
    },

    async setHuggingFaceToken(input) {
      return ensureSuccess(
        await desktopApi.setHuggingFaceToken({ token: input.token }),
        (value) => value as DesktopHuggingFaceTokenStatus,
        "Failed to store Hugging Face token.",
      );
    },

    async clearHuggingFaceToken() {
      return ensureSuccess(
        await desktopApi.clearHuggingFaceToken(),
        (value) => value as DesktopHuggingFaceTokenStatus,
        "Failed to clear Hugging Face token.",
      );
    },

    async browseHuggingFaceNamespaceDatasets(input) {
      return ensureSuccess(
        await desktopApi.browseHuggingFaceNamespaceDatasets({ namespace: input.namespace }),
        (value) => {
          const datasets = (value as { datasets?: DesktopHuggingFaceNamespaceDataset[] } | undefined)?.datasets;
          return Array.isArray(datasets) ? datasets : [];
        },
        "Failed to browse Hugging Face namespace datasets.",
      );
    },

    async browseHuggingFaceDatasetParquetFiles(input) {
      return ensureSuccess(
        await desktopApi.browseHuggingFaceDatasetParquetFiles({
          repository: input.repository,
          revision: input.revision,
        }),
        (value) => {
          const files = (value as { files?: DesktopHuggingFaceDatasetParquetFile[] } | undefined)?.files;
          return Array.isArray(files) ? files : [];
        },
        "Failed to browse Hugging Face dataset parquet files.",
      );
    },

    async browseArtifacts(input = {}) {
      return ensureSuccess(
        await desktopApi.browseArtifacts({ artifactFamily: input.artifactFamily }),
        (value) => toBrowseItems(value),
        "Failed to browse artifacts.",
      );
    },

    async browseUnregisteredArtifacts() {
      if (!desktopApi.browseUnregisteredArtifacts) {
        return [];
      }
      return ensureSuccess(
        await desktopApi.browseUnregisteredArtifacts(),
        (value) => {
          const items = (value as { items?: DesktopUnregisteredArtifactBrowseItem[] } | undefined)?.items;
          return Array.isArray(items) ? items : [];
        },
        "Failed to browse unregistered artifacts.",
      );
    },

    async registerUnregisteredArtifact(input) {
      if (!desktopApi.registerUnregisteredArtifact) {
        throw new Error("Desktop preload unregistered artifact register bridge is unavailable.");
      }
      return ensureSuccess(
        await desktopApi.registerUnregisteredArtifact({ storageKey: input.storageKey }),
        (value) => value as { storageKey: string },
        "Failed to register unregistered artifact.",
      );
    },

    async deleteUnregisteredArtifact(input) {
      if (!desktopApi.deleteUnregisteredArtifact) {
        throw new Error("Desktop preload unregistered artifact delete bridge is unavailable.");
      }
      return ensureSuccess(
        await desktopApi.deleteUnregisteredArtifact({ storageKey: input.storageKey }),
        (value) => value as { storageKey: string },
        "Failed to delete unregistered artifact.",
      );
    },


    async deleteRegisteredArtifact(input) {
      if (!desktopApi.deleteRegisteredArtifact) {
        throw new Error("Desktop preload registered artifact delete bridge is unavailable.");
      }
      return ensureSuccess(
        await desktopApi.deleteRegisteredArtifact({ storageKey: input.storageKey }),
        (value) => value as { storageKey: string },
        "Failed to delete registered artifact.",
      );
    },

    async readArtifactDetail(locator) {
      return ensureSuccess(
        await desktopApi.readArtifactDetail(locator),
        (value) => {
          const artifact = (value as { artifact?: DesktopArtifactDetail } | undefined)?.artifact;
          if (!artifact) {
            throw new Error("Artifact detail response is missing artifact.");
          }

          return artifact;
        },
        "Failed to read artifact detail.",
      );
    },

    async readArtifactContent(locator) {
      return ensureSuccess(
        await desktopApi.readArtifactContentDescriptor(locator),
        (value) => {
          const content = (value as { content?: DesktopArtifactContentDescriptor } | undefined)?.content;
          if (!content) {
            throw new Error("Artifact content response is missing content descriptor.");
          }

          return content;
        },
        "Failed to read artifact content descriptor.",
      );
    },

    async readArtifactMedia(locator) {
      const media = ensureSuccess(
        await desktopApi.readArtifactViewerMedia(locator),
        (value) => value as { mediaType?: string; bytes: Uint8Array },
        "Failed to read artifact media.",
      );

      return { mediaType: media.mediaType, bytes: Uint8Array.from(media.bytes) };
    },

    async createArtifactMediaViewUrl(locator) {
      const media = ensureSuccess(
        await desktopApi.readArtifactViewerMedia(locator),
        (value) => value as { mediaType?: string; bytes: Uint8Array },
        "Failed to read artifact media.",
      );

      const blobBytes = Uint8Array.from(media.bytes);
      const blob = new Blob([blobBytes], { type: media.mediaType ?? "application/octet-stream" });
      return URL.createObjectURL(blob);
    },

    async publishArtifactToHuggingFace(input) {
      return ensureSuccess(
        await desktopApi.publishArtifactToRepo({
          artifactId: input.artifactId,
          target: {
            provider: "huggingface",
            repository: input.repository,
            path: input.path,
            revision: input.revision,
          },
          mediaType: input.mediaType,
        }),
        (value) => value as DesktopPublishedBacking,
        "Failed to publish artifact.",
      );
    },

    async verifyPublishedArtifactBacking(input) {
      return ensureSuccess(
        await desktopApi.verifyPublishedArtifactBacking({
          artifactId: input.artifactId,
        }),
        (value) => value as DesktopPublishedBacking,
        "Failed to verify published artifact backing.",
      );
    },

    async verifyImportedSourceBacking(input) {
      if (!desktopApi.verifyImportedArtifactSourceBacking) {
        throw new Error("Desktop preload source verification bridge is unavailable.");
      }
      return ensureSuccess(
        await desktopApi.verifyImportedArtifactSourceBacking({
          artifactId: input.artifactId,
        }),
        (value) => value as DesktopPublishedBacking,
        "Failed to verify imported source backing.",
      );
    },

    async registerArtifactFromRepo(input) {
      return ensureSuccess(
        await desktopApi.registerArtifactFromRepo({
          target: {
            provider: "huggingface",
            repository: input.repository,
            path: input.path,
            revision: input.revision,
          },
          mediaType: input.mediaType,
        }),
        (value) => value as DesktopRegisteredArtifactFromRepo,
        "Failed to register artifact from repo.",
      );
    },

    async localizeArtifactFromRepo(input) {
      return ensureSuccess(
        await desktopApi.localizeArtifactFromRepo({
          artifactId: input.artifactId,
        }),
        (value) => value as DesktopLocalizedArtifactFromRepo,
        "Failed to localize artifact from repo.",
      );
    },
  };
}
