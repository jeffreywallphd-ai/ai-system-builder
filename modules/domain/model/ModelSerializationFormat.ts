export const MODEL_SERIALIZATION_FORMATS = [
  "safetensors",
  "sharded-safetensors",
  "pytorch-bin",
  "adapter-safetensors",
  "unknown",
] as const;

export type ModelSerializationFormat = (typeof MODEL_SERIALIZATION_FORMATS)[number];

const MODEL_SERIALIZATION_FORMAT_SET = new Set<string>(MODEL_SERIALIZATION_FORMATS);

export function normalizeModelSerializationFormat(value: string): ModelSerializationFormat {
  const normalized = value.trim().toLowerCase();
  if (MODEL_SERIALIZATION_FORMAT_SET.has(normalized)) {
    return normalized as ModelSerializationFormat;
  }

  throw new Error(
    `Model serialization format must be one of: ${MODEL_SERIALIZATION_FORMATS.join(", ")}. Received: ${value}`,
  );
}
