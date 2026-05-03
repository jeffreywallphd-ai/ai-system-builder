export const MODEL_TASK_TAGS = [
  "text-generation",
  "text2text-generation",
  "chat",
  "embeddings",
  "classification",
  "summarization",
  "question-answering",
  "code-generation",
  "text-to-image",
] as const;

export type ModelTaskTag = (typeof MODEL_TASK_TAGS)[number];

const MODEL_TASK_TAG_SET = new Set<string>(MODEL_TASK_TAGS);

export function normalizeModelTaskTag(value: string): ModelTaskTag {
  const normalized = value.trim().toLowerCase();
  if (MODEL_TASK_TAG_SET.has(normalized)) {
    return normalized as ModelTaskTag;
  }

  throw new Error(`Model task tag must be one of: ${MODEL_TASK_TAGS.join(", ")}. Received: ${value}`);
}

export function normalizeModelTaskTags(values: readonly string[] | undefined): ModelTaskTag[] | undefined {
  if (!values) {
    return undefined;
  }

  return values.map((value) => normalizeModelTaskTag(value));
}
