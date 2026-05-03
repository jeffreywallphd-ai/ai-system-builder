export const MODEL_BROWSE_PROVIDERS = ["huggingface", "unknown"] as const;

export type ModelBrowseProvider = (typeof MODEL_BROWSE_PROVIDERS)[number];

const MODEL_BROWSE_PROVIDER_SET = new Set<string>(MODEL_BROWSE_PROVIDERS);

export function normalizeModelBrowseProvider(value: string): ModelBrowseProvider {
  const normalized = value.trim().toLowerCase();
  if (MODEL_BROWSE_PROVIDER_SET.has(normalized)) {
    return normalized as ModelBrowseProvider;
  }

  throw new Error(
    `Model browse provider must be one of: ${MODEL_BROWSE_PROVIDERS.join(", ")}. Received: ${value}`,
  );
}
