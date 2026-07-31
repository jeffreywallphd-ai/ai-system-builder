import {
  getDesktopApi,
  type DesktopDeleteModelRecordResult,
  type DesktopDownloadModelResult,
  type DesktopStartModelDownloadResult,
  type DesktopReadModelDownloadResult,
  type DesktopListModelDownloadsResult,
  type DesktopCancelModelDownloadResult,
  type DesktopModelBrowseItem,
  type DesktopModelDetailsResult,
  type DesktopModelInventoryRecord,
  type DesktopModelBrowseRequest,
  type DesktopModelTrainingRequest,
  type DesktopModelTrainingResult,
  type DesktopValidateModelResult,
  type DesktopPublishModelResult,
  type DesktopRevealModelInFolderResult,
} from "../../../lib/desktopApi";
import type { ListModelsRequest, ModelTaskTag } from "../../../../../../../modules/contracts/model";
import { createWorkspaceId } from "../../../../../../../modules/contracts/workspace";

interface PreloadEnvelope {
  ok: boolean;
  value?: unknown;
  error?: { message?: string };
}


export type DesktopManagedModelInventoryRecord = DesktopModelInventoryRecord & {
  localFilesAvailable?: boolean;
  validationReportAvailable?: boolean;
};

function sanitizeModelRecord<T>(model: T): T {
  if (typeof model !== "object" || model === null) return model;
  const { localPath, validationReportPath, ...safeModel } = model as Record<string, unknown>;
  return {
    ...safeModel,
    localFilesAvailable: typeof localPath === "string" && localPath.trim().length > 0,
    validationReportAvailable:
      typeof validationReportPath === "string" && validationReportPath.trim().length > 0,
  } as T;
}

function sanitizeDownloadResult(result: DesktopDownloadModelResult): DesktopDownloadModelResult {
  const { localPath: _localPath, ...safeDownload } = result.download as Record<string, unknown>;
  return { ...result, model: sanitizeModelRecord(result.model), download: safeDownload as DesktopDownloadModelResult["download"] };
}

function ensureSuccess<T>(response: unknown, pick: (value: unknown) => T, fallback: string): T {
  if (typeof response !== "object" || response === null || !("ok" in response)) {
    throw new Error(fallback);
  }
  const envelope = response as PreloadEnvelope;
  if (!envelope.ok) {
    throw new Error(envelope.error?.message ?? fallback);
  }
  return pick(envelope.value);
}

export interface DesktopModelsClient {
  browseModels: (input: DesktopModelBrowseRequest) => Promise<{ models: DesktopModelBrowseItem[]; nextCursor?: string }>;
  getModelDetails: (input: { provider: "huggingface"; modelId: string }) => Promise<DesktopModelDetailsResult["model"]>;
  listModels: (input?: ListModelsRequest) => Promise<DesktopManagedModelInventoryRecord[]>;
  saveModelReference: (input: { modelId: string; displayName?: string; inferenceMode?: "text2text" | "causal" | "chat" | "text-to-image"; taskTags?: ModelTaskTag[]; artifactForm?: "full-model" | "adapter" | "merged-model" | "checkpoint"; metadata?: Record<string, unknown>; workspaceId: string }) => Promise<DesktopModelInventoryRecord>;
  downloadModel: (input: { modelId: string; displayName?: string; inferenceMode?: "text2text" | "causal" | "chat" | "text-to-image"; taskTags?: ModelTaskTag[]; artifactForm?: "full-model" | "adapter" | "merged-model" | "checkpoint"; metadata?: Record<string, unknown>; workspaceId: string }) => Promise<DesktopDownloadModelResult>;
  startModelDownload: (input: { modelId: string; displayName?: string; inferenceMode?: "text2text" | "causal" | "chat" | "text-to-image"; taskTags?: ModelTaskTag[]; artifactForm?: "full-model" | "adapter" | "merged-model" | "checkpoint"; metadata?: Record<string, unknown>; workspaceId: string }) => Promise<DesktopStartModelDownloadResult>;
  readModelDownload: (input: { requestId: string; workspaceId: string }) => Promise<DesktopReadModelDownloadResult>;
  listModelDownloads: (input: { workspaceId: string; includeCompleted?: boolean; limit?: number }) => Promise<DesktopListModelDownloadsResult>;
  cancelModelDownload: (input: { requestId: string; workspaceId: string }) => Promise<DesktopCancelModelDownloadResult>;
  updateModelRecord: (input: { modelRecordId: string; patch: Record<string, unknown> }) => Promise<DesktopModelInventoryRecord>;
  deleteModelRecord: (input: { modelRecordId: string; deleteLocalFiles?: boolean; deleteBackingArtifacts?: boolean; workspaceId: string }) => Promise<DesktopDeleteModelRecordResult>;
  revealModelInFolder: (input: { modelRecordId: string; workspaceId: string }) => Promise<DesktopRevealModelInFolderResult>;
  trainModel: (input: DesktopModelTrainingRequest) => Promise<DesktopModelTrainingResult>;
  readModelTrainingStatus: (input: { runId: string }) => Promise<DesktopModelTrainingResult>;
  validateModel: (input: { workspaceId: string; modelRecordId: string; modelPath?: string; expectedLoRA?: boolean }) => Promise<DesktopValidateModelResult>;
  publishModel: (input: {
    workspaceId: string;
    modelRecordId: string;
    repository: string;
    revision?: string;
    allowWarningValidation?: boolean;
    allowInvalidValidation?: boolean;
  }) => Promise<DesktopPublishModelResult>;
}

export function createDesktopModelsClient(): DesktopModelsClient {
  const desktopApi = getDesktopApi();
  return {
    async browseModels(input) {
      if (!desktopApi.browseModels) {
        throw new Error("Desktop preload model browse bridge is unavailable.");
      }
      return ensureSuccess(
        await desktopApi.browseModels(input),
        (value) => value as { models: DesktopModelBrowseItem[]; nextCursor?: string },
        "Failed to browse models.",
      );
    },
    async getModelDetails(input) {
      if (!desktopApi.getModelDetails) {
        throw new Error("Desktop preload model details bridge is unavailable.");
      }
      return ensureSuccess(
        await desktopApi.getModelDetails(input),
        (value) => (value as DesktopModelDetailsResult).model,
        "Failed to read model details.",
      );
    },
    async listModels(input = {}) {
      if (!desktopApi.listModels) {
        throw new Error("Desktop preload model list bridge is unavailable.");
      }
      return ensureSuccess(
        await desktopApi.listModels(input),
        (value) => ((value as { models: DesktopModelInventoryRecord[] }).models ?? []).map(sanitizeModelRecord),
        "Failed to list models.",
      );
    },
    async saveModelReference(input) {
      if (!desktopApi.saveModelReference) {
        throw new Error("Desktop preload model save bridge is unavailable.");
      }
      return ensureSuccess(
        await desktopApi.saveModelReference({
          provider: "huggingface",
          modelId: input.modelId,
          displayName: input.displayName,
          inferenceMode: input.inferenceMode,
          taskTags: input.taskTags,
          artifactForm: input.artifactForm,
          metadata: input.metadata,
          workspaceId: createWorkspaceId(input.workspaceId),
        }),
        (value) => sanitizeModelRecord((value as { model: DesktopModelInventoryRecord }).model),
        "Failed to save model reference.",
      );
    },
    async downloadModel(input) {
      if (desktopApi.startModelDownload && desktopApi.readModelDownload) {
        const started = ensureSuccess(
          await desktopApi.startModelDownload({ ...input, provider: "huggingface", workspaceId: createWorkspaceId(input.workspaceId) }),
          (value) => value as DesktopStartModelDownloadResult,
          "Failed to start model download.",
        );
        let activity = started.activity;
        while (activity.status === "queued" || activity.status === "running" || activity.status === "unknown") {
          await new Promise((resolve) => window.setTimeout(resolve, 1_000));
          activity = ensureSuccess(
            await desktopApi.readModelDownload({ workspaceId: createWorkspaceId(input.workspaceId), requestId: activity.requestId }),
            (value) => (value as DesktopReadModelDownloadResult).activity,
            "Failed to read model download.",
          );
        }
        if (activity.status !== "succeeded" || !activity.model) {
          throw new Error(activity.error?.message ?? `Model download ended with status ${activity.status}.`);
        }
        return {
          model: sanitizeModelRecord(activity.model),
          download: { provider: "transformers", modelId: activity.modelId, downloaded: true, fromCache: false },
        } as DesktopDownloadModelResult;
      }
      if (!desktopApi.downloadModel) {
        throw new Error("Desktop preload model download bridge is unavailable.");
      }
      return ensureSuccess(
        await desktopApi.downloadModel({
          provider: "huggingface",
          modelId: input.modelId,
          displayName: input.displayName,
          inferenceMode: input.inferenceMode,
          taskTags: input.taskTags,
          artifactForm: input.artifactForm,
          metadata: input.metadata,
          workspaceId: createWorkspaceId(input.workspaceId),
        }),
        (value) => sanitizeDownloadResult(value as DesktopDownloadModelResult),
        "Failed to download model.",
      );
    },
    async startModelDownload(input) {
      if (!desktopApi.startModelDownload) throw new Error("Desktop preload model download-start bridge is unavailable.");
      return ensureSuccess(
        await desktopApi.startModelDownload({ ...input, provider: "huggingface", workspaceId: createWorkspaceId(input.workspaceId) }),
        (value) => value as DesktopStartModelDownloadResult,
        "Failed to start model download.",
      );
    },
    async readModelDownload(input) {
      if (!desktopApi.readModelDownload) throw new Error("Desktop preload model download-read bridge is unavailable.");
      return ensureSuccess(
        await desktopApi.readModelDownload({ ...input, workspaceId: createWorkspaceId(input.workspaceId) }),
        (value) => value as DesktopReadModelDownloadResult,
        "Failed to read model download.",
      );
    },
    async listModelDownloads(input) {
      if (!desktopApi.listModelDownloads) throw new Error("Desktop preload model download-list bridge is unavailable.");
      return ensureSuccess(
        await desktopApi.listModelDownloads({ ...input, workspaceId: createWorkspaceId(input.workspaceId) }),
        (value) => value as DesktopListModelDownloadsResult,
        "Failed to list model downloads.",
      );
    },
    async cancelModelDownload(input) {
      if (!desktopApi.cancelModelDownload) throw new Error("Desktop preload model download-cancel bridge is unavailable.");
      return ensureSuccess(
        await desktopApi.cancelModelDownload({ ...input, workspaceId: createWorkspaceId(input.workspaceId) }),
        (value) => value as DesktopCancelModelDownloadResult,
        "Failed to cancel model download.",
      );
    },
    async updateModelRecord(input) {
      if (!desktopApi.updateModelRecord) {
        throw new Error("Desktop preload model update bridge is unavailable.");
      }
      return ensureSuccess(
        await desktopApi.updateModelRecord(input),
        (value) => sanitizeModelRecord((value as { model: DesktopModelInventoryRecord }).model),
        "Failed to update model record.",
      );
    },
    async deleteModelRecord(input) {
      if (!desktopApi.deleteModelRecord) {
        throw new Error("Desktop preload model delete bridge is unavailable.");
      }
      return ensureSuccess(
        await desktopApi.deleteModelRecord({ ...input, workspaceId: createWorkspaceId(input.workspaceId) }),
        (value) => value as DesktopDeleteModelRecordResult,
        "Failed to delete model record.",
      );
    },
    async revealModelInFolder(input) {
      if (!desktopApi.revealModelInFolder) {
        throw new Error("Desktop preload model folder bridge is unavailable.");
      }
      return ensureSuccess(
        await desktopApi.revealModelInFolder({
          ...input,
          workspaceId: createWorkspaceId(input.workspaceId),
        }),
        (value) => value as DesktopRevealModelInFolderResult,
        "Failed to open the model folder.",
      );
    },
    async trainModel(input) {
      if (!desktopApi.trainModel) {
        throw new Error("Desktop preload model training bridge is unavailable.");
      }
      return ensureSuccess(
        await desktopApi.trainModel(input),
        (value) => value as DesktopModelTrainingResult,
        "Failed to train model.",
      );
    },
    async readModelTrainingStatus(input) {
      if (!desktopApi.readModelTrainingStatus) {
        throw new Error("Desktop preload model training status bridge is unavailable.");
      }
      return ensureSuccess(
        await desktopApi.readModelTrainingStatus(input),
        (value) => value as DesktopModelTrainingResult,
        "Failed to read model training status.",
      );
    },
    async validateModel(input) {
      if (!desktopApi.validateModel) {
        throw new Error("Desktop preload model validation bridge is unavailable.");
      }
      return ensureSuccess(
        await desktopApi.validateModel({ ...input, workspaceId: createWorkspaceId(input.workspaceId) }),
        (value) => value as DesktopValidateModelResult,
        "Failed to validate model.",
      );
    },
    async publishModel(input) {
      if (!desktopApi.publishModel) {
        throw new Error("Desktop preload model publish bridge is unavailable.");
      }
      return ensureSuccess(
        await desktopApi.publishModel({ ...input, workspaceId: createWorkspaceId(input.workspaceId) }),
        (value) => value as DesktopPublishModelResult,
        "Failed to publish model.",
      );
    },
  };
}
