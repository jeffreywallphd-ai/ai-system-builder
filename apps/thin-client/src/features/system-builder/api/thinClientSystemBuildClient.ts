import type { SystemBuildResult } from "../../../../../../modules/contracts/system-build";
import type { SystemBuildClient } from "../../../../../../modules/ui/shared/system-builder";
import { parseApiEnvelope } from "../../../security/apiErrorEnvelope";
import { secureFetch } from "../../../security/secureFetch";

const failure = <T,>(message = "System builds are unavailable.", code = "unavailable"): SystemBuildResult<T> => ({ ok: false, error: { code, message } });

async function request<T>(url: string, init?: RequestInit): Promise<SystemBuildResult<T>> {
  try {
    const response = await secureFetch(url, init);
    const envelope = parseApiEnvelope(await response.json());
    if (envelope.ok) return { ok: true, value: envelope.value as T };
    return failure(envelope.error?.message ?? "The system build request failed.", envelope.error?.code ?? "internal");
  } catch {
    return failure();
  }
}

function post<T>(url: string, body: unknown): Promise<SystemBuildResult<T>> {
  return request<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export function createThinClientSystemBuildClient(baseUrl = "/api"): SystemBuildClient {
  const root = baseUrl.replace(/\/+$/, "");
  return {
    prepare: (input) => request(`${root}/systems/builds/preparation?workspaceId=${encodeURIComponent(input.workspaceId)}&systemId=${encodeURIComponent(input.systemId)}&systemRevisionId=${encodeURIComponent(input.systemRevisionId)}`),
    request: (input) => post(`${root}/systems/builds/request`, input),
    cancel: (input) => post(`${root}/systems/builds/cancel`, input),
    listBuilds: (input) => request(`${root}/systems/builds?workspaceId=${encodeURIComponent(input.workspaceId)}${input.systemId ? `&systemId=${encodeURIComponent(input.systemId)}` : ""}`),
    approve: (input) => post(`${root}/systems/releases/approve`, input),
    listReleases: (input) => request(`${root}/systems/releases?workspaceId=${encodeURIComponent(input.workspaceId)}${input.systemId ? `&systemId=${encodeURIComponent(input.systemId)}` : ""}`),
    publicationWorkspace: (input) => request(`${root}/systems/publication?workspaceId=${encodeURIComponent(input.workspaceId)}`),
    compare: (input) => request(`${root}/systems/releases/compare?workspaceId=${encodeURIComponent(input.workspaceId)}&leftReleaseId=${encodeURIComponent(input.leftReleaseId)}&rightReleaseId=${encodeURIComponent(input.rightReleaseId)}`),
  };
}
