import {
  getDesktopApi,
  type DesktopPrepareTrainingDatasetInput,
  type DesktopPreparedTrainingDatasetResult,
  type DesktopArtifactBrowseItem,
} from "../../../lib/desktopApi";
import { normalizeDatasetPreparationTransportError } from "../hooks/datasetPreparationTransport";
import type {
  DatasetVersionComparison,
  DatasetVersionPublicationRecord,
  DatasetVersionRecord,
  DatasetVersionReproduction,
} from "../../../../../../../modules/contracts/dataset";

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
  browseSourceArtifacts: (workspaceId?: string) => Promise<Array<{ artifactId: string; label: string; storageKey: string; mediaType?: string; sourceKind?: string }>>;
  startPrepareTrainingDataset: (
    input: DesktopPrepareTrainingDatasetInput,
    context?: DesktopDatasetPreparationRequestContext,
  ) => Promise<{ requestId: string } | { error: { code: string; message: string; details?: Record<string, unknown> } }>;
  readPrepareTrainingDatasetTask: (
    requestId: string,
    workspaceId?: string,
  ) => Promise<DesktopDatasetPreparationTaskReadResult>;
  cancelPrepareTrainingDatasetTask: (
    requestId: string,
    workspaceId?: string,
  ) => Promise<{ ok: true } | { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } }>;
  approvePreparedTrainingDataset: (
    requestId: string,
    reportFingerprint: string,
    workspaceId?: string,
  ) => Promise<DesktopDatasetPreparationResult>;
  listVersions?: (workspaceId: string, datasetId?: string) => Promise<readonly DatasetVersionRecord[]>;
  compareVersions?: (workspaceId: string, fromVersionId: string, toVersionId: string) => Promise<DatasetVersionComparison>;
  readReproduction?: (workspaceId: string, versionId: string) => Promise<DatasetVersionReproduction>;
  publishVersion?: (input: { workspaceId: string; versionId: string; repositoryId: string; visibility: "private" | "public"; createRepository?: boolean; publicAccessConfirmed?: true }) => Promise<DatasetVersionPublicationRecord>;
}
export type DesktopDatasetPreparationTaskReadResult =
  | { ok: true; status: "pending" | "running"; progress?: { message?: string; processed?: number; total?: number } }
  | { ok: true; status: "succeeded"; value: DesktopPreparedTrainingDatasetResult }
  | { ok: true; status: "review-required"; value: DesktopPreparedTrainingDatasetResult }
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
    async browseSourceArtifacts(workspaceId) {
      if (!workspaceId) return [];
      const payload = ensureSuccessEnvelope(
        await desktopApi.browseArtifacts({ workspaceId }),
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
          mediaType: artifact.mediaType,
          sourceKind: artifact.sourceKind,
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

    async readPrepareTrainingDatasetTask(requestId: string, workspaceId?: string) {
      if (!desktopApi.readPrepareTrainingDatasetTask) {
        return { ok: false, error: { code: "unavailable", message: "Dataset preparation is unavailable." } };
      }

      try {
        const response = await desktopApi.readPrepareTrainingDatasetTask({ requestId, workspaceId });
        if (!isPreloadResponseEnvelope(response)) {
          return { ok: false, error: { code: "internal", message: "Dataset preparation task read failed." } };
        }
        if (!response.ok) {
          return { ok: false, error: { code: response.error?.code ?? "internal", message: response.error?.message ?? "Dataset preparation failed.", details: response.error?.details } };
        }
        const value = response.value as { status?: string; progress?: { message?: string; processed?: number; total?: number; details?: Record<string, unknown> }; result?: DesktopPreparedTrainingDatasetResult; error?: { message?: string } } | undefined;
        if (
          (value?.status === "succeeded" ||
            value?.status === "review-required") &&
          value.result
        ) {
          return { ok: true, status: value.status, value: value.result };
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
    async cancelPrepareTrainingDatasetTask(requestId: string, workspaceId?: string) {
      if (!desktopApi.cancelPrepareTrainingDatasetTask) {
        return { ok: false, error: { code: "unavailable", message: "Dataset preparation cancellation is unavailable." } };
      }
      try {
        const response = await desktopApi.cancelPrepareTrainingDatasetTask({ requestId, workspaceId });
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
    async approvePreparedTrainingDataset(
      requestId: string,
      reportFingerprint: string,
      workspaceId?: string,
    ) {
      if (!desktopApi.approvePreparedTrainingDataset) {
        return {
          ok: false,
          error: {
            code: "unavailable",
            message: "Dataset approval is unavailable.",
          },
        };
      }
      try {
        const response = await desktopApi.approvePreparedTrainingDataset({
          requestId,
          reportFingerprint,
          workspaceId,
        });
        if (!isPreloadResponseEnvelope(response)) {
          return {
            ok: false,
            error: {
              code: "internal",
              message: "Dataset approval failed.",
            },
          };
        }
        if (!response.ok) {
          return {
            ok: false,
            error: {
              code: response.error?.code ?? "internal",
              message: response.error?.message ?? "Dataset approval failed.",
              details: response.error?.details,
            },
          };
        }
        const value = response.value as
          | { result?: DesktopPreparedTrainingDatasetResult }
          | undefined;
        if (!value?.result) {
          return {
            ok: false,
            error: {
              code: "internal",
              message: "Dataset approval response is incomplete.",
            },
          };
        }
        return { ok: true, value: value.result };
      } catch (error) {
        throw normalizeDatasetPreparationTransportError(error);
      }
    },
    async listVersions(workspaceId, datasetId) {
      if (!desktopApi.listDatasetVersions) throw new Error("Dataset version history is unavailable.");
      const response = await desktopApi.listDatasetVersions({ workspaceId, datasetId });
      const value = ensureSuccessEnvelope(response, "Dataset version history could not be loaded.").value as { versions?: readonly DatasetVersionRecord[] } | undefined;
      return Array.isArray(value?.versions) ? value.versions : [];
    },
    async compareVersions(workspaceId, fromVersionId, toVersionId) {
      if (!desktopApi.compareDatasetVersions) throw new Error("Dataset version comparison is unavailable.");
      const response = await desktopApi.compareDatasetVersions({ workspaceId, fromVersionId, toVersionId });
      const value = ensureSuccessEnvelope(response, "Dataset versions could not be compared.").value as { comparison?: DatasetVersionComparison } | undefined;
      if (!value?.comparison) throw new Error("Dataset version comparison is incomplete.");
      return value.comparison;
    },
    async readReproduction(workspaceId, versionId) {
      if (!desktopApi.readDatasetVersionReproduction) throw new Error("Saved dataset setup is unavailable.");
      const response = await desktopApi.readDatasetVersionReproduction({ workspaceId, versionId });
      const value = ensureSuccessEnvelope(response, "Saved dataset setup could not be loaded.").value as { reproduction?: DatasetVersionReproduction } | undefined;
      if (!value?.reproduction) throw new Error("Saved dataset setup is incomplete.");
      return value.reproduction;
    },
    async publishVersion(input) {
      if (!desktopApi.publishDatasetVersion) throw new Error("Dataset publishing is unavailable.");
      const response = await desktopApi.publishDatasetVersion(input);
      const value = ensureSuccessEnvelope(response, "Dataset version could not be published.").value as { publication?: DatasetVersionPublicationRecord } | undefined;
      if (!value?.publication) throw new Error("Dataset publication response is incomplete.");
      return value.publication;
    },
  };
}
