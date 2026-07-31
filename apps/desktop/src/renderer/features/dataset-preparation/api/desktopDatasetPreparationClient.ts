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

function isPreloadResponseEnvelope(
  value: unknown,
): value is PreloadResponseEnvelope {
  return typeof value === "object" && value !== null && "ok" in value;
}

export type DesktopDatasetPreparationResult =
  | { ok: true; value: DesktopPreparedTrainingDatasetResult }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
      };
    };

export interface DesktopDatasetPreparationRequestContext {
  requestId?: string;
  correlationId?: string;
}

export interface DesktopDatasetPreparationClient {
  browseSourceArtifacts: (workspaceId?: string) => Promise<
    Array<{
      artifactId: string;
      label: string;
      storageKey: string;
      mediaType?: string;
      sourceKind?: string;
    }>
  >;
  startPrepareTrainingDataset: (
    input: DesktopPrepareTrainingDatasetInput,
    context?: DesktopDatasetPreparationRequestContext,
  ) => Promise<
    | { requestId: string }
    | {
        error: {
          code: string;
          message: string;
          details?: Record<string, unknown>;
        };
      }
  >;
  readPrepareTrainingDatasetTask: (
    requestId: string,
    workspaceId?: string,
  ) => Promise<DesktopDatasetPreparationTaskReadResult>;
  cancelPrepareTrainingDatasetTask: (
    requestId: string,
    workspaceId?: string,
  ) => Promise<
    | { ok: true }
    | {
        ok: false;
        error: {
          code: string;
          message: string;
          details?: Record<string, unknown>;
        };
      }
  >;
  approvePreparedTrainingDataset: (
    requestId: string,
    reportFingerprint: string,
    workspaceId?: string,
  ) => Promise<DesktopDatasetPreparationResult>;
  listVersions?: (
    workspaceId: string,
    datasetId?: string,
  ) => Promise<readonly DatasetVersionRecord[]>;
  compareVersions?: (
    workspaceId: string,
    fromVersionId: string,
    toVersionId: string,
  ) => Promise<DatasetVersionComparison>;
  readReproduction?: (
    workspaceId: string,
    versionId: string,
  ) => Promise<DatasetVersionReproduction>;
  publishVersion?: (input: {
    workspaceId: string;
    versionId: string;
    repositoryId: string;
    visibility: "private" | "public";
    createRepository?: boolean;
    publicAccessConfirmed?: true;
  }) => Promise<DatasetVersionPublicationRecord>;
}
export type DesktopDatasetPreparationTaskReadResult =
  | {
      ok: true;
      status: "pending" | "running";
      progress?: {
        message?: string;
        processed?: number;
        total?: number;
        phase?: string;
        memoryOverflowActive?: boolean;
        estimatedMemoryOverflowBytes?: number;
        memoryOverflowLimitBytes?: number;
      };
    }
  | {
      ok: true;
      status: "succeeded";
      value: DesktopPreparedTrainingDatasetResult;
    }
  | {
      ok: true;
      status: "review-required";
      value: DesktopPreparedTrainingDatasetResult;
    }
  | { ok: true; status: "cancelled" }
  | { ok: true; status: "unknown"; message?: string }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
      };
    };

function mapDatasetProgress(
  progress:
    | {
        message?: string;
        processed?: number;
        total?: number;
        details?: Record<string, unknown>;
      }
    | undefined,
) {
  if (!progress) {
    return undefined;
  }
  return {
    message: progress.message,
    phase:
      typeof progress.details?.phase === "string"
        ? progress.details.phase
        : undefined,
    memoryOverflowActive:
      progress.details?.memoryOverflowActive === true,
    estimatedMemoryOverflowBytes:
      typeof progress.details?.estimatedMemoryOverflowBytes === "number"
        ? progress.details.estimatedMemoryOverflowBytes
        : undefined,
    memoryOverflowLimitBytes:
      typeof progress.details?.memoryOverflowLimitBytes === "number"
        ? progress.details.memoryOverflowLimitBytes
        : undefined,
    processed:
      typeof progress.processed === "number"
        ? progress.processed
        : typeof progress.details?.processedChunkCount === "number"
          ? progress.details.processedChunkCount
          : undefined,
    total:
      typeof progress.total === "number"
        ? progress.total
        : typeof progress.details?.totalChunkCount === "number"
          ? progress.details.totalChunkCount
          : undefined,
  };
}

function ensureSuccessEnvelope(
  response: unknown,
  fallbackMessage: string,
): { value?: unknown } {
  if (!isPreloadResponseEnvelope(response)) {
    throw new Error(fallbackMessage);
  }

  if (!response.ok) {
    throw new Error(response.error?.message ?? fallbackMessage);
  }

  return { value: response.value };
}

const DATASET_PREPARATION_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  preparation_input_intent_ambiguous:
    "The selected files mix existing datasets with source material. Prepare those groups separately.",
  preparation_plan_mismatch:
    "The preparation method no longer matches the selected files. Return to Step 3, choose a method again, and retry.",
  preparation_inactive_normalization:
    "Some preparation settings conflict with the selected method. Return to Step 3, reselect the method, and retry.",
  preparation_inactive_chunking:
    "Some preparation settings conflict with the selected method. Return to Step 3, reselect the method, and retry.",
  preparation_inactive_generation:
    "Some preparation settings conflict with the selected method. Return to Step 3, reselect the method, and retry.",
  preparation_generation_mode_mismatch:
    "Some preparation settings conflict with the selected method. Return to Step 3, reselect the method, and retry.",
  preparation_advanced_mismatch:
    "Some Advanced settings conflict with the selected method. Return to Step 3, reselect the method, and retry.",
  preparation_inactive_advanced:
    "Advanced document settings are not used by the selected method. Return to Step 3, reselect the method, and retry.",
  split_validation_failed:
    "Training, validation, and test portions need review. Make sure they add up to 1.0 and keep some data for validation or testing.",
  structured_output_settings_invalid:
    "The desired output format needs review. Reset or correct it in Generation prompt, then retry.",
  generation_model_not_available:
    "The selected generation model is not ready. Download it in Step 3, then retry.",
  generation_model_download_incomplete:
    "The selected generation model download is incomplete. Resume the download in Step 3, then retry.",
  generation_runtime_dependency_unavailable:
    "Local model generation needs repair. Restart the application to repair its managed components, then retry.",
  generation_insufficient_resources:
    "The selected model cannot fit in the memory currently available. Close memory-heavy applications or select a smaller built-in model, then retry.",
  generation_model_load_failed:
    "The selected model files could not be loaded. Verify or download the model again, or choose the compact model, then retry.",
  generation_constrained_decoding_failed:
    "Token-level JSON formatting could not complete with this model and desired output format. Review the format or turn off constrained decoding, then retry.",
  generation_constrained_decoding_unavailable:
    "Token-level JSON formatting is not available with the current local model tools. Restart after the tools are ready, or turn off Keep generated JSON well structured.",
  generation_constrained_decoding_truncated:
    "Token-level JSON formatting reached the output length limit. Increase Maximum new tokens or simplify the desired output format, then retry.",
  generation_output_invalid:
    "The model response did not match the desired output format. Review the Generation prompt and desired output format, then retry.",
  generation_inference_failed:
    "The selected model could not complete generation. Verify the model and available system resources, then retry.",
  generation_settings_missing:
    "Choose a generation method and model in Step 3, then retry.",
  structured_source_read_failed:
    "The selected structured file could not be read. Verify that it is a valid CSV, JSON, JSON Lines, or Parquet file, then retry.",
  structured_source_no_usable_rows:
    "The selected structured data does not contain the fields needed for this training goal. Choose a compatible dataset or another training goal.",
  synthetic_review_required:
    "This preparation method requires data checks and review. Keep data checks enabled and retry.",
  advanced_quality_review_required:
    "This preparation method requires data checks and review. Keep data checks enabled and retry.",
  normalization_failed:
    "One or more selected files could not be read. Review the file types and retry.",
  chunking_failed:
    "The source could not be divided using the selected method. Review the Step 3 preparation settings and retry.",
  chunk_limit_exceeded:
    "The selected settings created too many source sections. Reduce the source size or adjust the Step 3 preparation settings.",
  generation_no_examples:
    "No usable training examples were created. Review the selected source, generation prompt, and model, then retry.",
  generation_failed:
    "The model could not create valid training examples. Review the generation prompt and desired output format, then retry.",
  text_generation_failed:
    "The model could not create a required text value. Review the generation prompt and model, then retry.",
  text_generation_empty:
    "The model returned an empty required value. Review the generation prompt and desired output format, then retry.",
  source_association_invalid:
    "A generated training item could not be linked to its source. Reselect the source files and retry.",
  dataset_preparation_task_unsupported:
    "The selected training goal is not supported by the local runtime yet.",
  dataset_preparation_no_manifest_rows:
    "No usable image training rows could be created. Review the selected files and their labels or annotations.",
  runtime_timeout:
    "Dataset preparation took longer than allowed. Retry with fewer files or smaller source sections.",
};

function mapDatasetPreparationTaskFailure(
  error:
    | {
        code?: string;
        stage?: string;
      }
    | undefined,
): {
  code: string;
  message: string;
  details?: Record<string, unknown>;
} {
  const code =
    typeof error?.code === "string" && /^[a-z][a-z0-9_]{0,95}$/.test(error.code)
      ? error.code
      : "task_failed";
  const stage =
    typeof error?.stage === "string" &&
    ["normalization", "chunking", "generation", "split"].includes(error.stage)
      ? error.stage
      : undefined;
  return {
    code,
    message:
      DATASET_PREPARATION_FAILURE_MESSAGES[code] ??
      "Dataset preparation could not finish. Review the selected files and settings, then retry.",
    ...(stage ? { details: { stage, reasonCode: code } } : {}),
  };
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
        if (
          typeof artifact.artifactId !== "string" ||
          artifact.artifactId.trim().length === 0
        ) {
          throw new Error("Artifact browse item is missing artifactId.");
        }
        if (
          typeof artifact.storageKey !== "string" ||
          artifact.storageKey.trim().length === 0
        ) {
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
        const response = await desktopApi.startPrepareTrainingDataset(
          input,
          context,
        );
        if (!isPreloadResponseEnvelope(response)) {
          return {
            error: {
              code: "internal",
              message: "Dataset preparation failed to start.",
            },
          };
        }
        if (!response.ok) {
          return {
            error: {
              code: response.error?.code ?? "internal",
              message:
                response.error?.message ??
                "Dataset preparation failed to start.",
              details: response.error?.details,
            },
          };
        }
        const payload = { value: response.value };
        const requestId = (payload.value as { requestId?: string } | undefined)
          ?.requestId;
        if (typeof requestId !== "string" || requestId.trim().length === 0) {
          return {
            error: {
              code: "internal",
              message: "Dataset preparation start response missing requestId.",
            },
          };
        }
        return { requestId };
      } catch (error) {
        throw normalizeDatasetPreparationTransportError(error);
      }
    },

    async readPrepareTrainingDatasetTask(
      requestId: string,
      workspaceId?: string,
    ) {
      if (!desktopApi.readPrepareTrainingDatasetTask) {
        return {
          ok: false,
          error: {
            code: "unavailable",
            message: "Dataset preparation is unavailable.",
          },
        };
      }

      try {
        const response = await desktopApi.readPrepareTrainingDatasetTask({
          requestId,
          workspaceId,
        });
        if (!isPreloadResponseEnvelope(response)) {
          return {
            ok: false,
            error: {
              code: "internal",
              message: "Dataset preparation task read failed.",
            },
          };
        }
        if (!response.ok) {
          return {
            ok: false,
            error: {
              code: response.error?.code ?? "internal",
              message: response.error?.message ?? "Dataset preparation failed.",
              details: response.error?.details,
            },
          };
        }
        const value = response.value as
          | {
              status?: string;
              progress?: {
                message?: string;
                processed?: number;
                total?: number;
                details?: Record<string, unknown>;
              };
              result?: DesktopPreparedTrainingDatasetResult;
              error?: { code?: string; stage?: string; message?: string };
            }
          | undefined;
        if (
          (value?.status === "succeeded" ||
            value?.status === "review-required") &&
          value.result
        ) {
          return { ok: true, status: value.status, value: value.result };
        }
        if (value?.status === "failed") {
          return {
            ok: false,
            error: mapDatasetPreparationTaskFailure(value.error),
          };
        }
        if (value?.status === "cancelled") {
          return { ok: true, status: "cancelled" };
        }
        if (value?.status === "unknown") {
          return {
            ok: true,
            status: "unknown",
            message: value.error?.message ?? value.progress?.message,
          };
        }
        return {
          ok: true,
          status: value?.status === "running" ? "running" : "pending",
          progress: mapDatasetProgress(value?.progress),
        };
      } catch (error) {
        throw normalizeDatasetPreparationTransportError(error);
      }
    },
    async cancelPrepareTrainingDatasetTask(
      requestId: string,
      workspaceId?: string,
    ) {
      if (!desktopApi.cancelPrepareTrainingDatasetTask) {
        return {
          ok: false,
          error: {
            code: "unavailable",
            message: "Dataset preparation cancellation is unavailable.",
          },
        };
      }
      try {
        const response = await desktopApi.cancelPrepareTrainingDatasetTask({
          requestId,
          workspaceId,
        });
        if (!isPreloadResponseEnvelope(response)) {
          return {
            ok: false,
            error: {
              code: "internal",
              message: "Dataset preparation task cancel failed.",
            },
          };
        }
        if (!response.ok) {
          return {
            ok: false,
            error: {
              code: response.error?.code ?? "internal",
              message:
                response.error?.message ??
                "Dataset preparation task cancel failed.",
              details: response.error?.details,
            },
          };
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
          { result?: DesktopPreparedTrainingDatasetResult } | undefined;
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
      if (!desktopApi.listDatasetVersions)
        throw new Error("Dataset version history is unavailable.");
      const response = await desktopApi.listDatasetVersions({
        workspaceId,
        datasetId,
      });
      const value = ensureSuccessEnvelope(
        response,
        "Dataset version history could not be loaded.",
      ).value as { versions?: readonly DatasetVersionRecord[] } | undefined;
      return Array.isArray(value?.versions) ? value.versions : [];
    },
    async compareVersions(workspaceId, fromVersionId, toVersionId) {
      if (!desktopApi.compareDatasetVersions)
        throw new Error("Dataset version comparison is unavailable.");
      const response = await desktopApi.compareDatasetVersions({
        workspaceId,
        fromVersionId,
        toVersionId,
      });
      const value = ensureSuccessEnvelope(
        response,
        "Dataset versions could not be compared.",
      ).value as { comparison?: DatasetVersionComparison } | undefined;
      if (!value?.comparison)
        throw new Error("Dataset version comparison is incomplete.");
      return value.comparison;
    },
    async readReproduction(workspaceId, versionId) {
      if (!desktopApi.readDatasetVersionReproduction)
        throw new Error("Saved dataset setup is unavailable.");
      const response = await desktopApi.readDatasetVersionReproduction({
        workspaceId,
        versionId,
      });
      const value = ensureSuccessEnvelope(
        response,
        "Saved dataset setup could not be loaded.",
      ).value as { reproduction?: DatasetVersionReproduction } | undefined;
      if (!value?.reproduction)
        throw new Error("Saved dataset setup is incomplete.");
      return value.reproduction;
    },
    async publishVersion(input) {
      if (!desktopApi.publishDatasetVersion)
        throw new Error("Dataset publishing is unavailable.");
      const response = await desktopApi.publishDatasetVersion(input);
      const value = ensureSuccessEnvelope(
        response,
        "Dataset version could not be published.",
      ).value as { publication?: DatasetVersionPublicationRecord } | undefined;
      if (!value?.publication)
        throw new Error("Dataset publication response is incomplete.");
      return value.publication;
    },
  };
}
