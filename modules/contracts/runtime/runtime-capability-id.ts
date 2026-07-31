export const RUNTIME_CAPABILITY_IDS = [
  "python-runtime",
  "comfyui-runtime",
  "image-generation",
  "dataset-preparation",
  "model-training",
  "model-validation",
  "model-publishing",
] as const;

export type RuntimeCapabilityId = (typeof RUNTIME_CAPABILITY_IDS)[number];

export function isRuntimeCapabilityId(value: string): value is RuntimeCapabilityId {
  return (RUNTIME_CAPABILITY_IDS as readonly string[]).includes(value);
}

export function normalizeRuntimeCapabilityId(value: string): RuntimeCapabilityId {
  const normalized = value.trim().toLowerCase();
  if (!isRuntimeCapabilityId(normalized)) {
    throw new Error(`Unknown runtime capability id: ${value}`);
  }

  return normalized;
}
