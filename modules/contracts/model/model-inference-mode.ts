import type { LocalModelConfig } from "../runtime";

export const MODEL_INFERENCE_MODES = ["text2text", "causal", "chat", "text-to-image"] as const;

export type ModelInferenceMode = Exclude<NonNullable<LocalModelConfig["inferenceMode"]>, "auto">;

const MODEL_INFERENCE_MODE_SET = new Set<string>(MODEL_INFERENCE_MODES);

export function normalizeModelInferenceMode(value: string): ModelInferenceMode {
  const normalized = value.trim().toLowerCase();
  if (MODEL_INFERENCE_MODE_SET.has(normalized)) {
    return normalized as ModelInferenceMode;
  }

  throw new Error(
    `Model inference mode must be one of: ${MODEL_INFERENCE_MODES.join(", ")}. Received: ${value}`,
  );
}
