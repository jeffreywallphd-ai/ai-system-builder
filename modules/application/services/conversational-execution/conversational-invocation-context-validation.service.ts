import {
  MAX_ASSISTANT_RESPONSE_LENGTH,
  MAX_USER_MESSAGE_LENGTH,
  normalizeAssistantVisibleResponseText,
  normalizeUserVisibleMessageText,
} from "../../../contracts/conversations";
import type {
  ApprovedConversationalInvocationSource,
  ConversationalInvocationRuntimeReference,
  ProtectedConversationalInvocationContext,
} from "../../ports/conversational-execution";

const MAX_HISTORY_ENTRIES = 50;
const MAX_HISTORY_CONTENT_LENGTH = MAX_ASSISTANT_RESPONSE_LENGTH * 2;
const MAX_OUTPUT_TOKENS = 8_192;
const CONTROL_CHARACTERS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;
const LONG_BASE64 =
  /(?:^|[^A-Za-z0-9+/])[A-Za-z0-9+/]{512,}={0,2}(?:$|[^A-Za-z0-9+/])/;
const PRIVATE_KEY = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i;
const KNOWN_TOKEN =
  /\b(?:AKIA[A-Z0-9]{16}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/;
const SIGNED_URL =
  /https?:\/\/[^\s]+[?&](?:X-Amz-Signature|sig|signature)=[^\s&]{16,}/i;
const STACK_TRACE = /(?:^|\n)\s*at\s+\S+[^\n]*(?:\n\s*at\s+\S+[^\n]*){1,}/;
const ENVIRONMENT_DUMP =
  /(?:^|\n)(?:[A-Z][A-Z0-9_]{2,}=[^\n]{1,240}\n){2,}[A-Z][A-Z0-9_]{2,}=[^\n]{1,240}(?:$|\n)/;

const CONTEXT_KEYS = new Set([
  "contextKind",
  "source",
  "runtime",
  "userTurnContent",
  "systemInstruction",
  "history",
  "generation",
]);
const SOURCE_KEYS = new Set([
  "workspaceId",
  "conversationSessionId",
  "sourceExecutionPlanId",
  "sourceCompositionPlanId",
  "sourceRuntimeReadinessBindingId",
  "executionApprovalId",
  "runtimeReferenceId",
]);
const RUNTIME_KEYS = new Set([
  "runtimeId",
  "capabilityKind",
  "runtimeReferenceId",
  "selectedModelRecordId",
]);
const HISTORY_KEYS = new Set(["role", "content"]);
const GENERATION_KEYS = new Set(["temperature", "maxOutputTokens"]);

export type ConversationalInvocationContextValidationFailureReason =
  | "protected-context-shape-invalid"
  | "protected-context-association-mismatch"
  | "user-content-invalid"
  | "system-instruction-invalid"
  | "history-too-large"
  | "history-content-invalid"
  | "history-content-too-large"
  | "generation-settings-invalid"
  | "unsafe-protected-context";

export type ConversationalInvocationContextValidationResult =
  | Readonly<{ valid: true }>
  | Readonly<{
      valid: false;
      reason: ConversationalInvocationContextValidationFailureReason;
    }>;

export type ConversationalInvocationContextExpectation = Readonly<{
  source: ApprovedConversationalInvocationSource;
  runtime: ConversationalInvocationRuntimeReference;
}>;

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const hasOnlyKeys = (
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean => Object.keys(value).every((key) => allowed.has(key));

const hasSafeReferences = (value: Record<string, unknown>): boolean =>
  Object.values(value).every(
    (reference) =>
      typeof reference === "string" && SAFE_REFERENCE.test(reference),
  );

const referencesMatch = (
  actual: Record<string, unknown>,
  expected: object,
): boolean =>
  Object.entries(expected).every(([key, value]) => actual[key] === value);

const hasCredentialAssignment = (value: string): boolean => {
  const match =
    /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*[']?([^\s',;]{8,})/i.exec(
      value,
    );
  if (!match) return false;
  return !/(?:redacted|placeholder|example|dummy|sample|test)/i.test(match[1]);
};

const hasBearerCredential = (value: string): boolean => {
  const match = /\bBearer\s+([A-Za-z0-9._~+/-]{24,}={0,2})\b/i.exec(value);
  if (!match) return false;
  return !/(?:redacted|placeholder|example|dummy|sample|test)/i.test(match[1]);
};

const isRawExecutableWorkflow = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isPlainRecord(parsed)) return false;
    return (
      (Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) ||
      (Array.isArray(parsed.steps) && Array.isArray(parsed.commands))
    );
  } catch {
    return false;
  }
};

const containsUnsafeMaterial = (value: string): boolean =>
  PRIVATE_KEY.test(value) ||
  KNOWN_TOKEN.test(value) ||
  SIGNED_URL.test(value) ||
  LONG_BASE64.test(value) ||
  STACK_TRACE.test(value) ||
  ENVIRONMENT_DUMP.test(value) ||
  /data:[^\s;,]+;base64,/i.test(value) ||
  hasCredentialAssignment(value) ||
  hasBearerCredential(value) ||
  isRawExecutableWorkflow(value);

const isValidInstruction = (value: unknown): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= MAX_USER_MESSAGE_LENGTH &&
  !CONTROL_CHARACTERS.test(value);

/**
 * Validates the transient protected shape without logging or persisting any of
 * its text fields. Technical vocabulary is allowed; only unexpected structure
 * and high-confidence raw secret/executable dumps are rejected.
 */
export class ConversationalInvocationContextValidationService {
  public validate(
    context: unknown,
    expected: ConversationalInvocationContextExpectation,
  ): ConversationalInvocationContextValidationResult {
    if (!isPlainRecord(context) || !hasOnlyKeys(context, CONTEXT_KEYS)) {
      return { valid: false, reason: "protected-context-shape-invalid" };
    }
    if (
      context.contextKind !== "protected-conversational-invocation" ||
      !isPlainRecord(context.source) ||
      !hasOnlyKeys(context.source, SOURCE_KEYS) ||
      !hasSafeReferences(context.source) ||
      !isPlainRecord(context.runtime) ||
      !hasOnlyKeys(context.runtime, RUNTIME_KEYS) ||
      !hasSafeReferences(context.runtime) ||
      context.runtime.capabilityKind !== "text-generation"
    ) {
      return { valid: false, reason: "protected-context-shape-invalid" };
    }

    if (
      !referencesMatch(context.source, expected.source) ||
      !referencesMatch(context.runtime, expected.runtime) ||
      context.source.runtimeReferenceId !== context.runtime.runtimeReferenceId
    ) {
      return {
        valid: false,
        reason: "protected-context-association-mismatch",
      };
    }

    try {
      normalizeUserVisibleMessageText(context.userTurnContent);
    } catch {
      return { valid: false, reason: "user-content-invalid" };
    }
    if (containsUnsafeMaterial(context.userTurnContent as string)) {
      return { valid: false, reason: "unsafe-protected-context" };
    }

    if (context.systemInstruction !== undefined) {
      if (!isValidInstruction(context.systemInstruction)) {
        return { valid: false, reason: "system-instruction-invalid" };
      }
      if (containsUnsafeMaterial(context.systemInstruction)) {
        return { valid: false, reason: "unsafe-protected-context" };
      }
    }

    if (context.history !== undefined) {
      if (!Array.isArray(context.history)) {
        return { valid: false, reason: "history-content-invalid" };
      }
      if (context.history.length > MAX_HISTORY_ENTRIES) {
        return { valid: false, reason: "history-too-large" };
      }
      let totalHistoryLength = 0;
      for (const entry of context.history) {
        if (
          !isPlainRecord(entry) ||
          !hasOnlyKeys(entry, HISTORY_KEYS) ||
          (entry.role !== "user" && entry.role !== "assistant")
        ) {
          return { valid: false, reason: "history-content-invalid" };
        }
        try {
          if (entry.role === "user") {
            normalizeUserVisibleMessageText(entry.content);
          } else {
            normalizeAssistantVisibleResponseText(entry.content);
          }
        } catch {
          return { valid: false, reason: "history-content-invalid" };
        }
        if (containsUnsafeMaterial(entry.content as string)) {
          return { valid: false, reason: "unsafe-protected-context" };
        }
        totalHistoryLength += (entry.content as string).length;
      }
      if (totalHistoryLength > MAX_HISTORY_CONTENT_LENGTH) {
        return { valid: false, reason: "history-content-too-large" };
      }
    }

    if (context.generation !== undefined) {
      if (
        !isPlainRecord(context.generation) ||
        !hasOnlyKeys(context.generation, GENERATION_KEYS)
      ) {
        return { valid: false, reason: "generation-settings-invalid" };
      }
      const { temperature, maxOutputTokens } = context.generation;
      if (
        (temperature !== undefined &&
          (typeof temperature !== "number" ||
            !Number.isFinite(temperature) ||
            temperature < 0 ||
            temperature > 2)) ||
        (maxOutputTokens !== undefined &&
          (typeof maxOutputTokens !== "number" ||
            !Number.isInteger(maxOutputTokens) ||
            maxOutputTokens < 1 ||
            maxOutputTokens > MAX_OUTPUT_TOKENS))
      ) {
        return { valid: false, reason: "generation-settings-invalid" };
      }
    }

    return { valid: true };
  }
}
