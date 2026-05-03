import {
  getDesktopApi,
  type DesktopDeleteModelRecordResult,
  type DesktopDownloadModelResult,
  type DesktopModelBrowseItem,
  type DesktopModelDetailsResult,
  type DesktopModelInventoryRecord,
  type DesktopModelBrowseRequest,
  type DesktopModelTrainingRequest,
  type DesktopModelTrainingResult,
  type DesktopValidateModelResult,
  type DesktopPublishModelResult,
} from "../../../lib/desktopApi";
import type { ListModelsRequest, ModelTaskTag } from "../../../../../../../modules/contracts/model";

interface PreloadEnvelope {
  ok: boolean;
  value?: unknown;
  error?: { message?: string };
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
  listModels: (input?: ListModelsRequest) => Promise<DesktopModelInventoryRecord[]>;
  saveModelReference: (input: { modelId: string; displayName?: string; inferenceMode?: "text2text" | "causal" | "chat" | "text-to-image"; taskTags?: ModelTaskTag[]; artifactForm?: "full-model" | "adapter" | "merged-model" | "checkpoint"; metadata?: Record<string, unknown> }) => Promise<DesktopModelInventoryRecord>;
  downloadModel: (input: { modelId: string; displayName?: string; inferenceMode?: "text2text" | "causal" | "chat" | "text-to-image"; taskTags?: ModelTaskTag[]; artifactForm?: "full-model" | "adapter" | "merged-model" | "checkpoint"; metadata?: Record<string, unknown> }) => Promise<DesktopDownloadModelResult>;
  updateModelRecord: (input: { modelRecordId: string; patch: Record<string, unknown> }) => Promise<DesktopModelInventoryRecord>;
  deleteModelRecord: (input: { modelRecordId: string; deleteLocalFiles?: boolean; deleteBackingArtifacts?: boolean }) => Promise<DesktopDeleteModelRecordResult>;
  trainModel: (input: DesktopModelTrainingRequest) => Promise<DesktopModelTrainingResult>;
  readModelTrainingStatus: (input: { runId: string }) => Promise<DesktopModelTrainingResult>;
  validateModel: (input: { modelRecordId: string; modelPath?: string; expectedLoRA?: boolean }) => Promise<DesktopValidateModelResult>;
  publishModel: (input: {
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
        (value) => (value as { models: DesktopModelInventoryRecord[] }).models ?? [],
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
        }),
        (value) => (value as { model: DesktopModelInventoryRecord }).model,
        "Failed to save model reference.",
      );
    },
    async downloadModel(input) {
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
        }),
        (value) => value as DesktopDownloadModelResult,
        "Failed to download model.",
      );
    },
    async updateModelRecord(input) {
      if (!desktopApi.updateModelRecord) {
        throw new Error("Desktop preload model update bridge is unavailable.");
      }
      return ensureSuccess(
        await desktopApi.updateModelRecord(input),
        (value) => (value as { model: DesktopModelInventoryRecord }).model,
        "Failed to update model record.",
      );
    },
    async deleteModelRecord(input) {
      if (!desktopApi.deleteModelRecord) {
        throw new Error("Desktop preload model delete bridge is unavailable.");
      }
      return ensureSuccess(
        await desktopApi.deleteModelRecord(input),
        (value) => value as DesktopDeleteModelRecordResult,
        "Failed to delete model record.",
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
        await desktopApi.validateModel(input),
        (value) => value as DesktopValidateModelResult,
        "Failed to validate model.",
      );
    },
    async publishModel(input) {
      if (!desktopApi.publishModel) {
        throw new Error("Desktop preload model publish bridge is unavailable.");
      }
      return ensureSuccess(
        await desktopApi.publishModel(input),
        (value) => value as DesktopPublishModelResult,
        "Failed to publish model.",
      );
    },
  };
}
