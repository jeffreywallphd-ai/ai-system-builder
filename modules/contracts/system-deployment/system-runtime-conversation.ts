export const SYSTEM_RUNTIME_CONVERSATION_SCHEMA_VERSION = "1.0" as const;
export const SYSTEM_RUNTIME_CONVERSATION_MAX_INPUT_CHARACTERS = 16_000;
export const SYSTEM_RUNTIME_CONVERSATION_MAX_TRANSCRIPT_TURNS = 100;

export type SystemRuntimeConversationMessage = Readonly<{
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}>;

export interface SystemRuntimeConversationView {
  readonly schemaVersion: typeof SYSTEM_RUNTIME_CONVERSATION_SCHEMA_VERSION;
  readonly title: string;
  readonly state: "ready" | "submitting" | "unavailable";
  readonly messages: readonly SystemRuntimeConversationMessage[];
  readonly maxInputCharacters: number;
  readonly canSubmit: boolean;
  readonly statusMessage?: string;
}

export interface SubmitSystemRuntimeConversationTurnCommand {
  readonly text: string;
  readonly operationId: string;
}

export type SystemRuntimeConversationErrorCode =
  | "invalid-request"
  | "runtime-unavailable"
  | "runtime-conflict"
  | "runtime-busy"
  | "turn-failed";

export type SystemRuntimeConversationResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code: SystemRuntimeConversationErrorCode;
        message: string;
      }>;
    }>;

const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ERROR_CODES = new Set<SystemRuntimeConversationErrorCode>([
  "invalid-request",
  "runtime-unavailable",
  "runtime-conflict",
  "runtime-busy",
  "turn-failed",
]);

export function normalizeSubmitSystemRuntimeConversationTurnCommand(
  value: unknown,
): SubmitSystemRuntimeConversationTurnCommand {
  const record = asRecord(value);
  if (
    typeof record.text !== "string" ||
    record.text.length > SYSTEM_RUNTIME_CONVERSATION_MAX_INPUT_CHARACTERS ||
    !record.text.trim()
  ) {
    throw new Error("The conversation message is invalid.");
  }
  if (
    typeof record.operationId !== "string" ||
    !OPERATION_ID_PATTERN.test(record.operationId)
  ) {
    throw new Error("The conversation operation is invalid.");
  }
  return { text: record.text, operationId: record.operationId };
}

export function isSystemRuntimeConversationViewResult(
  value: unknown,
): value is SystemRuntimeConversationResult<SystemRuntimeConversationView> {
  const record = optionalRecord(value);
  if (!record || typeof record.ok !== "boolean") return false;
  if (record.ok === false) {
    const error = optionalRecord(record.error);
    return Boolean(
      error &&
        typeof error.code === "string" &&
        ERROR_CODES.has(error.code as SystemRuntimeConversationErrorCode) &&
        safeText(error.message, 240),
    );
  }
  const view = optionalRecord(record.value);
  if (
    !view ||
    view.schemaVersion !== SYSTEM_RUNTIME_CONVERSATION_SCHEMA_VERSION ||
    !safeText(view.title, 240) ||
    !["ready", "submitting", "unavailable"].includes(String(view.state)) ||
    view.maxInputCharacters !== SYSTEM_RUNTIME_CONVERSATION_MAX_INPUT_CHARACTERS ||
    typeof view.canSubmit !== "boolean" ||
    (view.statusMessage !== undefined && !safeText(view.statusMessage, 240)) ||
    !Array.isArray(view.messages) ||
    view.messages.length > SYSTEM_RUNTIME_CONVERSATION_MAX_TRANSCRIPT_TURNS * 2
  ) {
    return false;
  }
  return view.messages.every((message) => {
    const item = optionalRecord(message);
    return Boolean(
      item &&
        safeText(item.id, 240) &&
        (item.role === "user" || item.role === "assistant") &&
        safeText(item.text, 64_000) &&
        typeof item.createdAt === "string" &&
        ISO_TIMESTAMP_PATTERN.test(item.createdAt),
    );
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) throw new Error("The conversation request is invalid.");
  return record;
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function safeText(value: unknown, maximum: number): boolean {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum &&
    !/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(value)
  );
}
