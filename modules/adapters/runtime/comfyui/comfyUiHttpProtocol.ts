function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ComfyUI payload: ${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

export interface ComfyUiQueueResponse {
  queue_running: unknown[];
  queue_pending: unknown[];
}

export interface ComfyUiHistoryResponse {
  [promptId: string]: unknown;
}

export interface ComfyUiPromptResponse {
  prompt_id: string;
  number?: number;
  node_errors?: Record<string, unknown>;
}

export function mapComfyUiQueueResponse(payload: unknown): ComfyUiQueueResponse {
  const record = asObject(payload, "queue response");
  const queueRunning = record.queue_running;
  const queuePending = record.queue_pending;
  if (!Array.isArray(queueRunning) || !Array.isArray(queuePending)) {
    throw new Error("Invalid ComfyUI payload: queue response must include array fields queue_running and queue_pending.");
  }

  return {
    queue_running: queueRunning,
    queue_pending: queuePending,
  };
}

export function mapComfyUiHistoryResponse(payload: unknown): ComfyUiHistoryResponse {
  return asObject(payload, "history response");
}

export function mapComfyUiPromptResponse(payload: unknown): ComfyUiPromptResponse {
  const record = asObject(payload, "prompt response");
  if (typeof record.prompt_id !== "string" || record.prompt_id.trim().length === 0) {
    throw new Error("Invalid ComfyUI payload: prompt response must include prompt_id.");
  }

  const number = typeof record.number === "number" && Number.isFinite(record.number) ? record.number : undefined;
  const nodeErrors = record.node_errors && typeof record.node_errors === "object" && !Array.isArray(record.node_errors)
    ? record.node_errors as Record<string, unknown>
    : undefined;

  return {
    prompt_id: record.prompt_id,
    number,
    node_errors: nodeErrors,
  };
}
