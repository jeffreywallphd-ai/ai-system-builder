import {
  getDesktopApi,
  type DesktopPrepareTrainingDatasetInput,
  type DesktopPreparedTrainingDatasetResult,
  type DesktopArtifactBrowseItem,
} from "../../../lib/desktopApi";
import { normalizeDatasetPreparationTransportError } from "../hooks/datasetPreparationTransport";

interface PreloadResponseEnvelope {
  ok: boolean;
  value?: unknown;
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
}

function isPreloadResponseEnvelope(value: unknown): value is PreloadResponseEnvelope {
  return typeof value === "object" && value !== null && "ok" in value;
}

export type DesktopDatasetPreparationResult =
  | { ok: true; value: DesktopPreparedTrainingDatasetResult }
  | { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } };

export interface DesktopDatasetPreparationRequestContext {
  requestId?: string;
  correlationId?: string;
}

export interface DesktopDatasetPreparationClient {
  browseSourceArtifacts: () => Promise<Array<{ artifactId: string; label: string; storageKey: string }>>;
  startPrepareTrainingDataset: (
    input: DesktopPrepareTrainingDatasetInput,
    context?: DesktopDatasetPreparationRequestContext,
  ) => Promise<{ requestId: string } | { error: { code: string; message: string; details?: Record<string, unknown> } }>;
  readPrepareTrainingDatasetTask: (
    requestId: string,
  ) => Promise<DesktopDatasetPreparationTaskReadResult>;
  cancelPrepareTrainingDatasetTask: (
    requestId: string,
  ) => Promise<{ ok: true } | { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } }>;
}
export type DesktopDatasetPreparationTaskReadResult =
  | { ok: true; status: "pending" | "running"; progress?: { message?: string; processed?: number; total?: number } }
  | { ok: true; status: "succeeded"; value: DesktopPreparedTrainingDatasetResult }
  | { ok: true; status: "cancelled" }
  | { ok: true; status: "unknown"; message?: string }
  | { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } };

function mapDatasetProgress(progress: { message?: string; processed?: number; total?: number; details?: Record<string, unknown> } | undefined) {
  if (!progress) {
    return undefined;
  }
  return {
    message: progress.message,
    processed: typeof progress.processed === "number"
      ? progress.processed
      : (typeof progress.details?.processedChunkCount === "number" ? progress.details.processedChunkCount : undefined),
    total: typeof progress.total === "number"
      ? progress.total
      : (typeof progress.details?.totalChunkCount === "number" ? progress.details.totalChunkCount : undefined),
  };
}

function ensureSuccessEnvelope(response: unknown, fallbackMessage: string): { value?: unknown } {
  if (!isPreloadResponseEnvelope(response)) {
    throw new Error(fallbackMessage);
  }

  if (!response.ok) {
    throw new Error(response.error?.message ?? fallbackMessage);
  }

  return { value: response.value };
}

function toBrowseItems(value: unknown): DesktopArtifactBrowseItem[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }

  const items = (value as { items?: DesktopArtifactBrowseItem[] }).items;
  return Array.isArray(items) ? items : [];
}

export function createDesktopDatasetPreparationClient(): DesktopDatasetPreparationClient {
  const desktopApi = getDesktopApi();

  return {
    async browseSourceArtifacts() {
      const payload = ensureSuccessEnvelope(
        await desktopApi.browseArtifacts(),
        "Failed to browse source artifacts.",
      );

      return toBrowseItems(payload.value).map((artifact) => {
        if (typeof artifact.artifactId !== "string" || artifact.artifactId.trim().length === 0) {
          throw new Error("Artifact browse item is missing artifactId.");
        }
        if (typeof artifact.storageKey !== "string" || artifact.storageKey.trim().length === 0) {
          throw new Error("Artifact browse item is missing storageKey.");
        }

        return {
          artifactId: artifact.artifactId,
          label: artifact.originalName ?? artifact.storageKey,
          storageKey: artifact.storageKey,
        };
      });
    },

    async startPrepareTrainingDataset(
      input: DesktopPrepareTrainingDatasetInput,
      context?: DesktopDatasetPreparationRequestContext,
    ) {
      if (!desktopApi.startPrepareTrainingDataset) {
        return {
          error: {
            code: "unavailable",
            message: "Dataset preparation is unavailable.",
          },
        };
      }

      try {
        const response = await desktopApi.startPrepareTrainingDataset(input, context);
        if (!isPreloadResponseEnvelope(response)) {
          return { error: { code: "internal", message: "Dataset preparation failed to start." } };
        }
        if (!response.ok) {
          return {
            error: {
              code: response.error?.code ?? "internal",
              message: response.error?.message ?? "Dataset preparation failed to start.",
              details: response.error?.details,
            },
          };
        }
        const payload = { value: response.value };
        const requestId = (payload.value as { requestId?: string } | undefined)?.requestId;
        if (typeof requestId !== "string" || requestId.trim().length === 0) {
          return {
            error: { code: "internal", message: "Dataset preparation start response missing requestId." },
          };
        }
        return { requestId };
      } catch (error) {
        throw normalizeDatasetPreparationTransportError(error);
      }
    },

    async readPrepareTrainingDatasetTask(requestId: string) {
      if (!desktopApi.readPrepareTrainingDatasetTask) {
        return { ok: false, error: { code: "unavailable", message: "Dataset preparation is unavailable." } };
      }

      try {
        const response = await desktopApi.readPrepareTrainingDatasetTask({ requestId });
        if (!isPreloadResponseEnvelope(response)) {
          return { ok: false, error: { code: "internal", message: "Dataset preparation task read failed." } };
        }
        if (!response.ok) {
          return { ok: false, error: { code: response.error?.code ?? "internal", message: response.error?.message ?? "Dataset preparation failed.", details: response.error?.details } };
        }
        const value = response.value as { status?: string; progress?: { message?: string; processed?: number; total?: number; details?: Record<string, unknown> }; result?: DesktopPreparedTrainingDatasetResult; error?: { message?: string } } | undefined;
        if (value?.status === "succeeded" && value.result) {
          return { ok: true, status: "succeeded", value: value.result };
        }
        if (value?.status === "failed") {
          return { ok: false, error: { code: "failed", message: value.error?.message ?? "Dataset preparation failed." } };
        }
        if (value?.status === "cancelled") {
          return { ok: true, status: "cancelled" };
        }
        if (value?.status === "unknown") {
          return { ok: true, status: "unknown", message: value.error?.message ?? value.progress?.message };
        }
        return { ok: true, status: value?.status === "running" ? "running" : "pending", progress: mapDatasetProgress(value?.progress) };
      } catch (error) {
        throw normalizeDatasetPreparationTransportError(error);
      }
    },
    async cancelPrepareTrainingDatasetTask(requestId: string) {
      if (!desktopApi.cancelPrepareTrainingDatasetTask) {
        return { ok: false, error: { code: "unavailable", message: "Dataset preparation cancellation is unavailable." } };
      }
      try {
        const response = await desktopApi.cancelPrepareTrainingDatasetTask({ requestId });
        if (!isPreloadResponseEnvelope(response)) {
          return { ok: false, error: { code: "internal", message: "Dataset preparation task cancel failed." } };
        }
        if (!response.ok) {
          return { ok: false, error: { code: response.error?.code ?? "internal", message: response.error?.message ?? "Dataset preparation task cancel failed.", details: response.error?.details } };
        }
        return { ok: true };
      } catch (error) {
        throw normalizeDatasetPreparationTransportError(error);
      }
    },
  };
}
