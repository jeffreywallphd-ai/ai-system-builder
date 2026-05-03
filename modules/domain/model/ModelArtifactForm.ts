export const MODEL_ARTIFACT_FORMS = [
  "full-model",
  "adapter",
  "merged-model",
  "quantized-model",
  "checkpoint",
] as const;

export type ModelArtifactForm = (typeof MODEL_ARTIFACT_FORMS)[number];

const MODEL_ARTIFACT_FORM_SET = new Set<string>(MODEL_ARTIFACT_FORMS);

export function normalizeModelArtifactForm(value: string): ModelArtifactForm {
  const normalized = value.trim().toLowerCase();
  if (MODEL_ARTIFACT_FORM_SET.has(normalized)) {
    return normalized as ModelArtifactForm;
  }

  throw new Error(`Model artifact form must be one of: ${MODEL_ARTIFACT_FORMS.join(", ")}. Received: ${value}`);
}
