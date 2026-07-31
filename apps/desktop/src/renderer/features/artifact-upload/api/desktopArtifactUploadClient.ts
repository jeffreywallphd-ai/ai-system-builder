import {
  getDesktopApi,
  type DesktopArtifactUploadApi,
  type DesktopArtifactUploadInput,
  type DesktopArtifactUploadResult,
  type DesktopWebsitePageIngestionResult,
  type DesktopWebsitePagesBatchItem,
  type DesktopWebsitePagesBatchSummary,
  type DesktopWebsiteIngestionTarget,
} from "../../../lib/desktopApi";
import { ARTIFACT_UPLOAD_MAXIMUM_BYTES } from "../../../../../../../modules/contracts/artifact-upload";

export interface ArtifactUploadAcceptedTypePolicy {
  acceptedMediaTypes: readonly string[];
  acceptedExtensions: readonly string[];
  maximumBytes?: number;
}

export type WebsiteIngestionMode = "automatic" | "rendered";

export interface WebsitePageIngestionFailure {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export interface WebsitePageIngestionSuccess {
  ok: true;
  value: DesktopWebsitePageIngestionResult;
}

export type WebsitePageIngestionClientResult = WebsitePageIngestionSuccess | WebsitePageIngestionFailure;

export interface WebsitePagesBatchIngestionSuccess {
  ok: true;
  value: {
    items: DesktopWebsitePagesBatchItem[];
    summary: DesktopWebsitePagesBatchSummary;
  };
}

export type WebsitePagesBatchIngestionClientResult = WebsitePagesBatchIngestionSuccess | WebsitePageIngestionFailure;

export interface ArtifactUploadClient {
  uploadArtifact: DesktopArtifactUploadApi["uploadArtifact"];
  getAcceptedTypes: () => Promise<ArtifactUploadAcceptedTypePolicy>;
  ingestWebsitePage: (input: {
    url: string;
    label?: string;
    mode?: WebsiteIngestionMode;
    workspaceId: string;
  }) => Promise<WebsitePageIngestionClientResult>;
  ingestWebsitePagesBatch: (input: {
    targets: DesktopWebsiteIngestionTarget[];
    mode?: WebsiteIngestionMode;
    workspaceId: string;
  }) => Promise<WebsitePagesBatchIngestionClientResult>;
}

interface PreloadResponseEnvelope {
  operation: string;
  channel: string;
  ok: boolean;
  value?: unknown;
  error?: {
    code?: string;
    message?: string;
  };
}

function isPreloadResponseEnvelope(value: unknown): value is PreloadResponseEnvelope {
  return typeof value === "object" && value !== null && "ok" in value;
}

function toRendererResult(response: unknown): DesktopArtifactUploadResult {
  if (!isPreloadResponseEnvelope(response)) {
    return {
      ok: false,
      error: {
        code: "internal",
        message: "Artifact upload failed.",
      },
    };
  }

  if (response.ok && response.value && typeof response.value === "object" && "descriptor" in response.value) {
    const descriptor = (response.value as { descriptor: { storage: { key: string; mediaType: string; sizeBytes: number } } }).descriptor;
    return {
      ok: true,
      value: {
        descriptor: {
          key: descriptor.storage.key,
          mediaType: descriptor.storage.mediaType,
          sizeBytes: descriptor.storage.sizeBytes,
        },
      },
    };
  }

  return {
    ok: false,
    error: {
      code: response.error?.code ?? "internal",
      message: response.error?.message ?? "Artifact upload failed.",
    },
  };
}

function toWebsitePageIngestionResult(response: unknown): WebsitePageIngestionClientResult {
  if (!isPreloadResponseEnvelope(response)) {
    return {
      ok: false,
      error: { code: "internal", message: "Website ingestion failed." },
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: {
        code: response.error?.code ?? "internal",
        message: response.error?.message ?? "Website ingestion failed.",
      },
    };
  }

  const result = (response.value as { result?: DesktopWebsitePageIngestionResult } | undefined)?.result;
  if (!result) {
    return {
      ok: false,
      error: { code: "internal", message: "Website ingestion response missing result payload." },
    };
  }

  return {
    ok: true,
    value: result,
  };
}

function toWebsitePagesBatchIngestionResult(response: unknown): WebsitePagesBatchIngestionClientResult {
  if (!isPreloadResponseEnvelope(response)) {
    return {
      ok: false,
      error: { code: "internal", message: "Website batch ingestion failed." },
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: {
        code: response.error?.code ?? "internal",
        message: response.error?.message ?? "Website batch ingestion failed.",
      },
    };
  }

  const rawValue = (response.value as { result?: { items?: unknown[]; summary?: DesktopWebsitePagesBatchSummary } } | undefined)?.result;
  if (!rawValue?.summary) {
    return {
      ok: false,
      error: { code: "internal", message: "Website batch ingestion response missing result payload." },
    };
  }

  const value = {
    items: (rawValue.items ?? []).map((item) => {
      const rawItem = item as {
        target: DesktopWebsiteIngestionTarget;
        ok?: boolean;
        result?: DesktopWebsitePageIngestionResult | {
          ok?: boolean;
          value?: DesktopWebsitePageIngestionResult;
          error?: { code?: string; message?: string };
        };
        error?: { code?: string; message?: string };
      };
      if (typeof rawItem.ok === "boolean") {
        return rawItem as DesktopWebsitePagesBatchItem;
      }
      const contractResult = rawItem.result as { ok?: boolean; value?: DesktopWebsitePageIngestionResult; error?: { code?: string; message?: string } } | undefined;
      return contractResult?.ok
        ? { target: rawItem.target, ok: true, result: contractResult.value }
        : {
          target: rawItem.target,
          ok: false,
          error: {
            code: contractResult?.error?.code ?? "internal",
            message: contractResult?.error?.message ?? "Website ingestion failed.",
          },
        };
    }),
    summary: rawValue.summary,
  };

  return {
    ok: true,
    value,
  };
}

export function createDesktopArtifactUploadClient(): ArtifactUploadClient {
  const desktopApi = getDesktopApi();

  return {
    async uploadArtifact(input: DesktopArtifactUploadInput): Promise<DesktopArtifactUploadResult> {
      if (!input.workspaceId?.trim()) {
        return { ok: false, error: { code: "validation", message: "Workspace id is required for artifact upload." } };
      }
      if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0) {
        return { ok: false, error: { code: "validation", message: "Artifact upload bytes are required." } };
      }
      if (input.bytes.byteLength > ARTIFACT_UPLOAD_MAXIMUM_BYTES) {
        return {
          ok: false,
          error: {
            code: "validation",
            message: `Artifact uploads must not exceed ${ARTIFACT_UPLOAD_MAXIMUM_BYTES} bytes.`,
          },
        };
      }

      const response = await desktopApi.uploadArtifact(input);
      return toRendererResult(response);
    },
    async getAcceptedTypes(): Promise<ArtifactUploadAcceptedTypePolicy> {
      const response = await desktopApi.getArtifactUploadPolicy();
      if (!isPreloadResponseEnvelope(response) || !response.ok || !response.value || typeof response.value !== "object" || !('policy' in response.value)) {
        throw new Error("Failed to read accepted artifact upload types.");
      }

      return (response.value as { policy: ArtifactUploadAcceptedTypePolicy }).policy;
    },
    async ingestWebsitePage(input) {
      if (!desktopApi.ingestWebsitePage) {
        return { ok: false, error: { code: "unavailable", message: "Website ingestion is unavailable." } };
      }
      return toWebsitePageIngestionResult(await desktopApi.ingestWebsitePage(input, { workspaceId: input.workspaceId }));
    },
    async ingestWebsitePagesBatch(input) {
      if (!desktopApi.ingestWebsitePagesBatch) {
        return { ok: false, error: { code: "unavailable", message: "Website batch ingestion is unavailable." } };
      }
      return toWebsitePagesBatchIngestionResult(await desktopApi.ingestWebsitePagesBatch(input, { workspaceId: input.workspaceId }));
    },
  };
}
