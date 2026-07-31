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
  type DesktopHuggingFaceFilesImportResult,
} from "../../../lib/desktopApi";
import { normalizeArtifactMediaBytes } from "../helpers/artifactMediaBytes";

export interface DesktopArtifactBrowserClient {
  getHuggingFaceTokenStatus: () => Promise<DesktopHuggingFaceTokenStatus>;
  setHuggingFaceToken: (input: {
    token: string;
  }) => Promise<DesktopHuggingFaceTokenStatus>;
  clearHuggingFaceToken: () => Promise<DesktopHuggingFaceTokenStatus>;
  browseHuggingFaceNamespaceDatasets?: (input: {
    namespace: string;
  }) => Promise<DesktopHuggingFaceNamespaceDataset[]>;
  browseHuggingFaceDatasetParquetFiles?: (input: {
    repository: string;
    revision?: string;
  }) => Promise<DesktopHuggingFaceDatasetParquetFile[]>;
  importHuggingFaceFiles?: (input: {
    repositories?: Array<{ repository: string; revision?: string }>;
    files?: Array<{
      repository: string;
      path: string;
      revision?: string;
      mediaType?: string;
    }>;
  }) => Promise<DesktopHuggingFaceFilesImportResult>;
  browseArtifacts: (input?: {
    artifactFamily?: DesktopArtifactFamily;
    workspaceId?: string;
  }) => Promise<DesktopArtifactBrowseItem[]>;
  browseUnregisteredArtifacts?: (input?: {
    workspaceId?: string;
  }) => Promise<DesktopUnregisteredArtifactBrowseItem[]>;
  registerUnregisteredArtifact?: (input: {
    storageKey: string;
    workspaceId?: string;
  }) => Promise<{ storageKey: string }>;
  deleteUnregisteredArtifact?: (input: {
    storageKey: string;
    workspaceId?: string;
  }) => Promise<{ storageKey: string }>;
  deleteRegisteredArtifact?: (input: {
    storageKey: string;
    workspaceId?: string;
  }) => Promise<{ storageKey: string }>;
  readArtifactDetail: (
    locator: DesktopArtifactBrowserLocator,
    input?: { workspaceId?: string },
  ) => Promise<DesktopArtifactDetail>;
  readArtifactContent: (
    locator: DesktopArtifactBrowserLocator,
    input?: { workspaceId?: string },
  ) => Promise<DesktopArtifactContentDescriptor>;
  createArtifactMediaViewUrl: (
    locator: DesktopArtifactBrowserLocator,
    input?: { workspaceId?: string; maximumBytes?: number },
  ) => Promise<string>;
  readArtifactMedia: (
    locator: DesktopArtifactBrowserLocator,
    input?: { workspaceId?: string; maximumBytes?: number },
  ) => Promise<{ mediaType?: string; bytes: Uint8Array }>;
  publishArtifactToHuggingFace: (input: {
    workspaceId?: string;
    artifactId: string;
    repository: string;
    path: string;
    revision?: string;
    mediaType?: string;
    repositoryCreation?: {
      approved: true;
      visibility: "private" | "public";
    };
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
    workspaceId: string;
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

  if (
    payload.registeredItemsMap &&
    typeof payload.registeredItemsMap === "object"
  ) {
    return Object.values(payload.registeredItemsMap);
  }

  return [];
}

function ensureSuccess<T>(
  response: unknown,
  pick: (value: unknown) => T,
  fallback: string,
): T {
  if (
    typeof response !== "object" ||
    response === null ||
    !("ok" in response)
  ) {
    throw new Error(fallback);
  }

  const envelope = response as {
    ok: boolean;
    value?: unknown;
    error?: { message?: string };
  };
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
        await desktopApi.browseHuggingFaceNamespaceDatasets({
          namespace: input.namespace,
        }),
        (value) => {
          const datasets = (
            value as
              { datasets?: DesktopHuggingFaceNamespaceDataset[] } | undefined
          )?.datasets;
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
          const files = (
            value as
              { files?: DesktopHuggingFaceDatasetParquetFile[] } | undefined
          )?.files;
          return Array.isArray(files) ? files : [];
        },
        "Failed to browse Hugging Face dataset parquet files.",
      );
    },

    async importHuggingFaceFiles(input) {
      if (!desktopApi.importHuggingFaceFiles) {
        throw new Error(
          "Desktop preload Hugging Face import bridge is unavailable.",
        );
      }
      return ensureSuccess(
        await desktopApi.importHuggingFaceFiles({
          repositories: input.repositories,
          files: input.files,
        }),
        (value) => value as DesktopHuggingFaceFilesImportResult,
        "Failed to import Hugging Face files.",
      );
    },

    async browseArtifacts(input = {}) {
      return ensureSuccess(
        await desktopApi.browseArtifacts(
          {
            artifactFamily: input.artifactFamily,
            workspaceId: input.workspaceId,
          },
          { workspaceId: input.workspaceId },
        ),
        (value) => toBrowseItems(value),
        "Failed to browse artifacts.",
      );
    },

    async browseUnregisteredArtifacts(input = {}) {
      if (!desktopApi.browseUnregisteredArtifacts) {
        return [];
      }
      return ensureSuccess(
        await desktopApi.browseUnregisteredArtifacts(
          { workspaceId: input?.workspaceId },
          { workspaceId: input?.workspaceId },
        ),
        (value) => {
          const items = (
            value as
              { items?: DesktopUnregisteredArtifactBrowseItem[] } | undefined
          )?.items;
          return Array.isArray(items) ? items : [];
        },
        "Failed to browse unregistered artifacts.",
      );
    },

    async registerUnregisteredArtifact(input) {
      if (!desktopApi.registerUnregisteredArtifact) {
        throw new Error(
          "Desktop preload unregistered artifact register bridge is unavailable.",
        );
      }
      return ensureSuccess(
        await desktopApi.registerUnregisteredArtifact(
          { storageKey: input.storageKey, workspaceId: input.workspaceId },
          { workspaceId: input.workspaceId },
        ),
        (value) => value as { storageKey: string },
        "Failed to register unregistered artifact.",
      );
    },

    async deleteUnregisteredArtifact(input) {
      if (!desktopApi.deleteUnregisteredArtifact) {
        throw new Error(
          "Desktop preload unregistered artifact delete bridge is unavailable.",
        );
      }
      return ensureSuccess(
        await desktopApi.deleteUnregisteredArtifact(
          { storageKey: input.storageKey, workspaceId: input.workspaceId },
          { workspaceId: input.workspaceId },
        ),
        (value) => value as { storageKey: string },
        "Failed to delete unregistered artifact.",
      );
    },

    async deleteRegisteredArtifact(input) {
      if (!desktopApi.deleteRegisteredArtifact) {
        throw new Error(
          "Desktop preload registered artifact delete bridge is unavailable.",
        );
      }
      return ensureSuccess(
        await desktopApi.deleteRegisteredArtifact(
          { storageKey: input.storageKey, workspaceId: input.workspaceId },
          { workspaceId: input.workspaceId },
        ),
        (value) => value as { storageKey: string },
        "Failed to delete registered artifact.",
      );
    },

    async readArtifactDetail(locator, input = {}) {
      return ensureSuccess(
        await desktopApi.readArtifactDetail(locator, {
          workspaceId: input.workspaceId,
        }),
        (value) => {
          const artifact = (
            value as { artifact?: DesktopArtifactDetail } | undefined
          )?.artifact;
          if (!artifact) {
            throw new Error("Artifact detail response is missing artifact.");
          }

          return artifact;
        },
        "Failed to read artifact detail.",
      );
    },

    async readArtifactContent(locator, input = {}) {
      return ensureSuccess(
        await desktopApi.readArtifactContentDescriptor(locator, {
          workspaceId: input.workspaceId,
        }),
        (value) => {
          const content = (
            value as { content?: DesktopArtifactContentDescriptor } | undefined
          )?.content;
          if (!content) {
            throw new Error(
              "Artifact content response is missing content descriptor.",
            );
          }

          return content;
        },
        "Failed to read artifact content descriptor.",
      );
    },

    async readArtifactMedia(locator, input = {}) {
      const media = ensureSuccess(
        await desktopApi.readArtifactViewerMedia(locator, {
          workspaceId: input.workspaceId,
          maximumBytes: input.maximumBytes,
        }),
        (value) => value as { mediaType?: string; bytes: Uint8Array },
        "Failed to read artifact media.",
      );

      return {
        mediaType: media.mediaType,
        bytes: normalizeArtifactMediaBytes(media.bytes),
      };
    },

    async createArtifactMediaViewUrl(locator, input = {}) {
      const media = ensureSuccess(
        await desktopApi.readArtifactViewerMedia(locator, {
          workspaceId: input.workspaceId,
          maximumBytes: input.maximumBytes,
        }),
        (value) => value as { mediaType?: string; bytes: Uint8Array },
        "Failed to read artifact media.",
      );
      const normalizedBytes = normalizeArtifactMediaBytes(media.bytes);
      if (typeof URL.createObjectURL !== "function") {
        throw new Error("Artifact media preview URLs are unavailable.");
      }
      const buffer = normalizedBytes.slice().buffer;
      return URL.createObjectURL(
        new Blob([buffer], {
          type: media.mediaType ?? "application/octet-stream",
        }),
      );
    },

    async publishArtifactToHuggingFace(input) {
      if (!input.workspaceId) {
        throw new Error("Workspace id is required to publish an artifact.");
      }
      return ensureSuccess(
        await desktopApi.publishArtifactToRepo(
          {
            workspaceId: input.workspaceId,
            artifactId: input.artifactId,
            target: {
              provider: "huggingface",
              repository: input.repository,
              path: input.path,
              revision: input.revision,
            },
            mediaType: input.mediaType,
            repositoryCreation: input.repositoryCreation,
          },
          { workspaceId: input.workspaceId },
        ),
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
        throw new Error(
          "Desktop preload source verification bridge is unavailable.",
        );
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
          workspaceId: input.workspaceId,
          artifactId: input.artifactId,
        }),
        (value) => value as DesktopLocalizedArtifactFromRepo,
        "Failed to localize artifact from repo.",
      );
    },
  };
}
