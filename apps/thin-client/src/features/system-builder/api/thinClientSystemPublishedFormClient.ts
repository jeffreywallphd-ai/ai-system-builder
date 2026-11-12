import type { SystemBuilderResult } from "../../../../../../modules/contracts/system-builder";
import type { SystemPublishedFormClient } from "../../../../../../modules/ui/shared/system-builder";
import { parseApiEnvelope } from "../../../security/apiErrorEnvelope";
import { secureFetch } from "../../../security/secureFetch";

async function request<T>(url: string, init?: RequestInit): Promise<SystemBuilderResult<T>> {
  try {
    const response = await secureFetch(url, init);
    const envelope = parseApiEnvelope(await response.json());
    if (response.ok && envelope.ok === true && envelope.value !== undefined) return { ok: true, value: envelope.value as T };
  } catch {
    // Do not expose transport or response details in the UI.
  }
  return { ok: false, error: { code: "system-form.unavailable", message: "Published forms are unavailable." } };
}

export function createThinClientSystemPublishedFormClient(baseUrl = "/api"): SystemPublishedFormClient {
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/systems/published-forms`;
  return {
    list: ({ workspaceId, releaseId }) => request(
      `${endpoint}?workspaceId=${encodeURIComponent(workspaceId)}&releaseId=${encodeURIComponent(releaseId)}`,
    ),
    submit: ({ workspaceId, releaseId, formId, submissionId, answers }) => request(`${endpoint}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, releaseId, formId, submissionId, answers }),
    }),
  };
}
