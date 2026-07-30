import type {
  SystemRunWorkflowFailureCode,
  SystemRunWorkflowResult,
} from "../../../../../../../modules/contracts/system-run-workflow";
import type { SystemRunWorkflowClient } from "../../../../../../../modules/ui/shared/system-builder";
import { getDesktopApi } from "../../../lib/desktopApi";

interface Envelope {
  readonly ok?: boolean;
  readonly value?: unknown;
  readonly error?: {
    readonly code?: unknown;
    readonly message?: unknown;
    readonly details?: unknown;
  };
}

const failure = <T>(
  message = "System workflows are unavailable.",
  code: SystemRunWorkflowFailureCode = "workflow.failed",
  field?: string,
): SystemRunWorkflowResult<T> => ({
  ok: false,
  error: { code, message, ...(field ? { field } : {}) },
});

function unwrap<T>(response: unknown): SystemRunWorkflowResult<T> {
  if (!response || typeof response !== "object" || Array.isArray(response))
    return failure("The desktop system workflow response was invalid.");
  const envelope = response as Envelope;
  if (envelope.ok === true)
    return { ok: true, value: envelope.value as T };
  const details = envelope.error?.details as
    | { readonly field?: unknown }
    | undefined;
  return failure(
    typeof envelope.error?.message === "string"
      ? envelope.error.message
      : "The system workflow request failed.",
    mapFailureCode(envelope.error?.code),
    typeof details?.field === "string" ? details.field : undefined,
  );
}

function mapFailureCode(code: unknown): SystemRunWorkflowFailureCode {
  if (typeof code === "string" && code.startsWith("workflow."))
    return code as SystemRunWorkflowFailureCode;
  switch (code) {
    case "forbidden":
      return "workflow.unauthorized";
    case "not-found":
      return "workflow.not-found";
    case "conflict":
      return "workflow.conflict";
    case "validation":
      return "workflow.validation";
    default:
      return "workflow.failed";
  }
}

export function createDesktopSystemRunWorkflowClient(): SystemRunWorkflowClient {
  const api = getDesktopApi();
  return {
    listProfiles: async (input) =>
      typeof api.listSystemRunWorkflowProfiles === "function"
        ? unwrap(await api.listSystemRunWorkflowProfiles(input))
        : failure(),
    prepare: async (input) =>
      typeof api.prepareSystemRunWorkflow === "function"
        ? unwrap(await api.prepareSystemRunWorkflow(input))
        : failure(),
    invoke: async (input) =>
      typeof api.invokeSystemRunWorkflow === "function"
        ? unwrap(await api.invokeSystemRunWorkflow(input))
        : failure(),
  };
}
