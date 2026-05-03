import { normalizeModelInferenceMode, type ModelInferenceMode } from "./model-inference-mode";

const TASK_TO_INFERENCE_MODE: Record<string, ModelInferenceMode> = {
  "text2text-generation": "text2text",
  "summarization": "text2text",
  "question-answering": "text2text",
  "text-generation": "causal",
  "chat": "chat",
  "text-to-image": "text-to-image",
};

function normalizeText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

export function recommendModelInferenceMode(input: {
  pipelineTag?: string;
  taskTags?: readonly string[];
}): ModelInferenceMode | undefined {
  const normalizedCandidates: string[] = [];

  const pipelineTag = normalizeText(input.pipelineTag);
  if (pipelineTag) {
    normalizedCandidates.push(pipelineTag);
  }

  for (const taskTag of input.taskTags ?? []) {
    const normalizedTaskTag = normalizeText(taskTag);
    if (normalizedTaskTag) {
      normalizedCandidates.push(normalizedTaskTag);
    }
  }

  for (const candidate of normalizedCandidates) {
    const mapped = TASK_TO_INFERENCE_MODE[candidate];
    if (mapped) {
      return normalizeModelInferenceMode(mapped);
    }
  }

  return undefined;
}
