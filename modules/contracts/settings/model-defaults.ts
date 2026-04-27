import type { LocalModelConfig } from "../runtime";
import type { ApplicationSettingKey } from "./application-settings";

export const MODEL_DEFAULT_TASK_KEYS = [
  "qaGeneration",
  "summarization",
  "classification",
  "embedding",
  "codeGeneration",
] as const;

export type ModelDefaultTaskKey = (typeof MODEL_DEFAULT_TASK_KEYS)[number];

export function isModelDefaultTaskKey(value: string): value is ModelDefaultTaskKey {
  return (MODEL_DEFAULT_TASK_KEYS as readonly string[]).includes(value);
}

export const MODEL_DEFAULT_FEATURE_KEYS = ["datasetPreparation"] as const;

export type ModelDefaultFeatureKey = (typeof MODEL_DEFAULT_FEATURE_KEYS)[number];

export function isModelDefaultFeatureKey(value: string): value is ModelDefaultFeatureKey {
  return (MODEL_DEFAULT_FEATURE_KEYS as readonly string[]).includes(value);
}

export type ModelDefaultInferenceMode = NonNullable<LocalModelConfig["inferenceMode"]>;

export interface ModelDefaultConfig extends Omit<LocalModelConfig, "inferenceMode"> {
  provider: "transformers";
  modelId: string;
  inferenceMode: ModelDefaultInferenceMode;
}

export interface ResolveModelDefaultRequest {
  taskKey: ModelDefaultTaskKey;
  featureKey?: ModelDefaultFeatureKey;
}

export interface ResolvedModelDefault extends ModelDefaultConfig {
  source: "feature" | "task" | "global" | "builtin";
  settingKey?: ApplicationSettingKey;
}

export const GLOBAL_MODEL_DEFAULT_SETTING_KEY: ApplicationSettingKey = "models.default";

export function createTaskModelDefaultSettingKey(taskKey: ModelDefaultTaskKey): ApplicationSettingKey {
  return `models.tasks.${taskKey}.default`;
}

export function createFeatureModelDefaultSettingKey(
  featureKey: ModelDefaultFeatureKey,
  taskKey: ModelDefaultTaskKey,
): ApplicationSettingKey {
  return `features.${featureKey}.${taskKey}.default`;
}

export function normalizeModelDefaultConfig(config: ModelDefaultConfig): ModelDefaultConfig {
  const modelId = config.modelId.trim();
  if (!modelId) {
    throw new Error("Model default config modelId must be a non-empty string.");
  }

  if (!["auto", "text2text", "causal", "chat"].includes(config.inferenceMode)) {
    throw new Error(
      `Model default config inferenceMode must be one of auto, text2text, causal, chat. Received "${String(config.inferenceMode)}".`,
    );
  }

  return {
    ...config,
    provider: "transformers",
    modelId,
  };
}
