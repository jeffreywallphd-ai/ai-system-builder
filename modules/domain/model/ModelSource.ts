export const MODEL_SOURCES = ["huggingface", "local", "generated"] as const;

export type ModelSource = (typeof MODEL_SOURCES)[number];

const MODEL_SOURCE_SET = new Set<string>(MODEL_SOURCES);

export function normalizeModelSource(value: string): ModelSource {
  const normalized = value.trim().toLowerCase();
  if (MODEL_SOURCE_SET.has(normalized)) {
    return normalized as ModelSource;
  }

  throw new Error(`Model source must be one of: ${MODEL_SOURCES.join(", ")}. Received: ${value}`);
}
