import type {
  SystemRunWorkflowFailureCode,
  SystemRunWorkflowResult,
} from "../../../../../../modules/contracts/system-run-workflow";
import type { SystemRunWorkflowClient } from "../../../../../../modules/ui/shared/system-builder";
import { parseApiEnvelope } from "../../../security/apiErrorEnvelope";
import { secureFetch } from "../../../security/secureFetch";

const failure = <T>(
  message = "System workflows are unavailable.",
  code: SystemRunWorkflowFailureCode = "workflow.failed",
  field?: string,
): SystemRunWorkflowResult<T> => ({
  ok: false,
  error: { code, message, ...(field ? { field } : {}) },
});

async function request<T>(
  url: string,
  init?: RequestInit,
): Promise<SystemRunWorkflowResult<T>> {
  try {
    const response = await secureFetch(url, init);
    const envelope = parseApiEnvelope(await response.json());
    if (envelope.ok) return { ok: true, value: envelope.value as T };
    const details = envelope.error?.details as
      | { readonly field?: unknown }
      | undefined;
    return failure(
      envelope.error?.message ?? "The system workflow request failed.",
      mapFailureCode(envelope.error?.code),
      typeof details?.field === "string" ? details.field : undefined,
    );
  } catch {
    return failure();
  }
}

const post = <T>(url: string, body: unknown) =>
  request<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

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

export function createThinClientSystemRunWorkflowClient(
  baseUrl = "/api",
): SystemRunWorkflowClient {
  const root = baseUrl.replace(/\/+$/, "");
  return {
    listProfiles: (input) => {
      const parameters = new URLSearchParams({
        workspaceId: input.workspaceId,
      });
      if (input.sourceKind)
        parameters.set("sourceKind", input.sourceKind);
      if (input.sourceId) parameters.set("sourceId", input.sourceId);
      return request(
        `${root}/systems/run-workflows?${parameters.toString()}`,
      );
    },
    prepare: (input) =>
      post(`${root}/systems/run-workflows/prepare`, input),
    invoke: (input) =>
      post(`${root}/systems/run-workflows/invoke`, input),
  };
}
